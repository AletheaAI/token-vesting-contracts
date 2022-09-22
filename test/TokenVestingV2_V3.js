const { expect } = require("chai");

describe("TokenVesting: V2 -> V3 Upgrade", function () {
	let Token;
	const totalSupply = 1000000;
	let testToken;
	let TokenVesting, TokenVestingV2, TokenVestingV3;
	let Proxy;
	let owner;
	let addr1;
	let addr2;
	let addrs;

	before(async function () {
		Token = await ethers.getContractFactory("Token");
		TokenVesting = await ethers.getContractFactory("MockTokenVesting");
		TokenVestingV2 = await ethers.getContractFactory("MockTokenVestingV2");
		TokenVestingV3 = await ethers.getContractFactory("MockTokenVestingV3");
		Proxy = await ethers.getContractFactory("ERC1967Proxy");
	});
	beforeEach(async function () {
		[owner, addr1, addr2, ...addrs] = await ethers.getSigners();
		testToken = await Token.deploy("Test Token", "TT", totalSupply);
		await testToken.deployed();
	});

	async function deploy_v1() {
		const tokenVesting = await TokenVesting.deploy();
		await tokenVesting.deployed();

		const init_data = (new ethers.utils.Interface(
			["function postConstruct(address token_, address treasury_)"]
		)).encodeFunctionData("postConstruct", [testToken.address, owner.address]);

		const proxy = await Proxy.deploy(tokenVesting.address, init_data);
		await proxy.deployed();

		return await TokenVesting.attach(proxy.address);
	}

	async function upgrade_to_v2(proxy) {
		const ref = await TokenVestingV2.attach(proxy.address);

		const tokenVestingV2 = await TokenVestingV2.deploy();
		await tokenVestingV2.deployed();

		await ref.upgradeTo(tokenVestingV2.address);

		return ref;
	}

	async function deploy_v2() {
		const proxy = await deploy_v1();
		return await upgrade_to_v2(proxy);
	}

	async function upgrade_to_v3(proxy) {
		const ref = await TokenVestingV3.attach(proxy.address);

		const tokenVestingV3 = await TokenVestingV3.deploy();
		await tokenVestingV3.deployed();

		await ref.upgradeTo(tokenVestingV3.address);

		return ref;
	}

	async function deploy_v3() {
		const proxy = await deploy_v2();
		return await upgrade_to_v3(proxy);
	}

	function run_test_suite(deployment_fn, upgrade_fn) {
		describe("Vesting", function() {
			it("Should assign the total supply of tokens to the owner", async function() {
				const ownerBalance = await testToken.balanceOf(owner.address);
				expect(await testToken.totalSupply()).to.equal(ownerBalance);
			});

			it("Should set token address correctly", async function() {
				// deploy vesting contract
				const tokenVesting = await deployment_fn();
				expect((await tokenVesting.getToken()).toString()).to.equal(testToken.address);
			});

			it("Should set treasury address correctly", async function() {
				// deploy vesting contract
				const tokenVesting = await deployment_fn();
				expect((await tokenVesting.getTreasury()).toString()).to.equal(owner.address);
			});

			it("Should update treasury address correctly", async function() {
				// deploy vesting contract
				const tokenVesting = await deployment_fn();
				await tokenVesting.setTreasury(addr1.address);
				expect((await tokenVesting.getTreasury()).toString()).to.equal(addr1.address);
			});

			it("Should create vesting schedule correctly", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 17;
				const duration = 1356;
				const slicePeriodSeconds = 3;
				const revocable = true;
				const amount = 342;
				const immediatelyReleasableAmount = 38;

				// create new vesting schedule
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				// compute vesting schedule id
				const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);

				// verify how vesting schedule was set
				expect(await tokenVesting.getVestingSchedulesTotalAmount()).to.equal(amount);
				expect(await tokenVesting.getVestingIdAtIndex(0)).to.equal(vestingScheduleId);

				const schedule = await tokenVesting.getVestingScheduleByAddressAndIndex(addr1.address, 0);
				expect(await tokenVesting.getLastVestingScheduleForHolder(addr1.address)).to.deep.equal(schedule);
				expect(schedule.initialized, "initialized").to.be.true;
				expect(schedule.beneficiary, "beneficiary").to.equal(beneficiary.address);
				expect(schedule.cliff, "cliff").to.equal(startTime + cliff);
				expect(schedule.start, "start").to.equal(startTime);
				expect(schedule.duration, "duration").to.equal(duration);
				expect(schedule.slicePeriodSeconds, "slicePeriodSeconds").to.equal(slicePeriodSeconds);
				expect(schedule.revocable, "revocable").to.be.true;
				expect(schedule.amountTotal, "amountTotal").to.equal(amount);
				expect(schedule.immediatelyReleasableAmount, "immediatelyReleasableAmount").to.equal(immediatelyReleasableAmount);
				expect(schedule.released, "released").to.equal(0);
				expect(schedule.revoked, "revoked").to.be.false;
			});

			it("Should not allow releasing before vesting schedule starts", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 17;
				const duration = 1356;
				const slicePeriodSeconds = 3;
				const revocable = true;
				const amount = 342;
				const immediatelyReleasableAmount = 38;

				// create new vesting schedule
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				// compute vesting schedule id
				const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);

				// check before start
				await tokenVesting.setCurrentTime(startTime - 1);
				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(0);
				// check during start
				await tokenVesting.setCurrentTime(startTime);
				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(immediatelyReleasableAmount);
				// what if we revoke before start?
				await tokenVesting.setCurrentTime(startTime - 1);
				await tokenVesting.revoke(vestingScheduleId);
				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(0);
			});

			it("Should vest tokens gradually", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();
				expect((await tokenVesting.getToken()).toString()).to.equal(testToken.address);
				// approve tokens to be spent by vesting contract
				await expect(testToken.approve(tokenVesting.address, 1000))
					.to.emit(testToken, "Approval")
					.withArgs(owner.address, tokenVesting.address, 1000);

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 100;
				const cliffTime = startTime + cliff;
				const duration = 1000;
				const slicePeriodSeconds = 1;
				const revocable = true;
				const amount = 100;

				// create new vesting schedule
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					0
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				expect(await tokenVesting.getVestingSchedulesCount()).to.be.equal(1);
				expect(await tokenVesting.getVestingSchedulesCountByBeneficiary(beneficiary.address)).to.be.equal(1);

				// compute vesting schedule id
				const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);

				// check that vested amount is 0
				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(0);

				// set time to half the vesting period
				const halfTime = cliffTime + (duration - cliff) / 2;
				await tokenVesting.setCurrentTime(halfTime);

				// check that vested amount is half the total amount to vest
				expect(await tokenVesting.connect(beneficiary).computeReleasableAmount(vestingScheduleId)).to.be.equal(50);

				// check that only beneficiary can try to release vested tokens
				await expect(tokenVesting.connect(addr2).release(vestingScheduleId, 100)).to.be.revertedWith(
					"TokenVesting: only beneficiary and owner can release vested tokens"
				);

				// check that beneficiary cannot release more than the vested amount
				await expect(tokenVesting.connect(beneficiary).release(vestingScheduleId, 100)).to.be.revertedWith(
					"TokenVesting: cannot release tokens, not enough vested tokens"
				);

				// release 10 tokens and check that a Transfer event is emitted with a value of 10
				await expect(tokenVesting.connect(beneficiary).release(vestingScheduleId, 10))
					.to.emit(testToken, "Transfer")
					.withArgs(owner.address, beneficiary.address, 10);

				// check that the vested amount is now 40
				expect(await tokenVesting.connect(beneficiary).computeReleasableAmount(vestingScheduleId)).to.be.equal(40);
				let vestingSchedule = await tokenVesting.getVestingSchedule(vestingScheduleId);

				// check that the released amount is 10
				expect(vestingSchedule.released).to.be.equal(10);

				// set current time after the end of the vesting period
				await tokenVesting.setCurrentTime(cliffTime + duration + 1);

				// check that the vested amount is 90
				expect(await tokenVesting.connect(beneficiary).computeReleasableAmount(vestingScheduleId)).to.be.equal(90);

				// beneficiary release vested tokens (45)
				await expect(tokenVesting.connect(beneficiary).release(vestingScheduleId, 45))
					.to.emit(testToken, "Transfer")
					.withArgs(owner.address, beneficiary.address, 45);

				// owner release vested tokens (45)
				await expect(tokenVesting.connect(owner).release(vestingScheduleId, 45))
					.to.emit(testToken, "Transfer")
					.withArgs(owner.address, beneficiary.address, 45);
				vestingSchedule = await tokenVesting.getVestingSchedule(vestingScheduleId);

				// check that the number of released tokens is 100
				expect(vestingSchedule.released).to.be.equal(100);

				// check that the vested amount is 0
				expect(await tokenVesting.connect(beneficiary).computeReleasableAmount(vestingScheduleId)).to.be.equal(0);

				// check that anyone cannot revoke a vesting
				await expect(tokenVesting.connect(addr2).revoke(vestingScheduleId)).to.be.revertedWith(
					"Ownable: caller is not the owner"
				);
				await tokenVesting.revoke(vestingScheduleId);

				/*
				 * TEST SUMMARY
				 * deploy vesting contract
				 * send tokens to vesting contract
				 * create new vesting schedule (100 tokens)
				 * check that vested amount is 0
				 * set time to half the vesting period
				 * check that vested amount is half the total amount to vest (50 tokens)
				 * check that only beneficiary can try to release vested tokens
				 * check that beneficiary cannot release more than the vested amount
				 * release 10 tokens and check that a Transfer event is emitted with a value of 10
				 * check that the released amount is 10
				 * check that the vested amount is now 40
				 * set current time after the end of the vesting period
				 * check that the vested amount is 90 (100 - 10 released tokens)
				 * release all vested tokens (90)
				 * check that the number of released tokens is 100
				 * check that the vested amount is 0
				 * check that anyone cannot revoke a vesting
				 */
			});

			it("Should vest tokens gradually when immediatelyReleasableAmount is set", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();
				expect((await tokenVesting.getToken()).toString()).to.equal(testToken.address);
				// approve tokens to be spent by vesting contract
				await expect(testToken.approve(tokenVesting.address, 1000))
					.to.emit(testToken, "Approval")
					.withArgs(owner.address, tokenVesting.address, 1000);

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 0;
				const duration = 1000;
				const slicePeriodSeconds = 1;
				const revocable = true;
				const amount = 110;
				const immediatelyReleasableAmount = 10;

				// create new vesting schedule
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				expect(await tokenVesting.getVestingSchedulesCount()).to.be.equal(1);
				expect(await tokenVesting.getVestingSchedulesCountByBeneficiary(beneficiary.address)).to.be.equal(1);

				// compute vesting schedule id
				const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);

				// check that vested amount is 0 before start
				await tokenVesting.setCurrentTime(startTime - 1);
				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(0);

				// check that vested amount is 10 after start
				await tokenVesting.setCurrentTime(startTime);
				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(10);

				// set time to half the vesting period
				const halfTime = baseTime + duration / 2;
				await tokenVesting.setCurrentTime(halfTime);

				// check that vested amount is half the total amount to vest
				expect(await tokenVesting.connect(beneficiary).computeReleasableAmount(vestingScheduleId)).to.be.equal(10 + 50);

				// check that only beneficiary can try to release vested tokens
				await expect(tokenVesting.connect(addr2).release(vestingScheduleId, 110)).to.be.revertedWith(
					"TokenVesting: only beneficiary and owner can release vested tokens"
				);

				// check that beneficiary cannot release more than the vested amount
				await expect(tokenVesting.connect(beneficiary).release(vestingScheduleId, 10 + 50 + 1)).to.be.revertedWith(
					"TokenVesting: cannot release tokens, not enough vested tokens"
				);

				// release 20 (10 + 10) tokens and check that a Transfer event is emitted with a value of 20
				await expect(tokenVesting.connect(beneficiary).release(vestingScheduleId, 20))
					.to.emit(testToken, "Transfer")
					.withArgs(owner.address, beneficiary.address, 20);

				// check that the vested amount is now 40
				expect(await tokenVesting.connect(beneficiary).computeReleasableAmount(vestingScheduleId)).to.be.equal(40);
				let vestingSchedule = await tokenVesting.getVestingSchedule(vestingScheduleId);

				// check that the released amount is 20
				expect(vestingSchedule.released).to.be.equal(20);

				// set current time after the end of the vesting period
				await tokenVesting.setCurrentTime(baseTime + duration + 1);

				// check that the vested amount is 90
				expect(await tokenVesting.connect(beneficiary).computeReleasableAmount(vestingScheduleId)).to.be.equal(90);

				// beneficiary release vested tokens (45)
				await expect(tokenVesting.connect(beneficiary).release(vestingScheduleId, 45))
					.to.emit(testToken, "Transfer")
					.withArgs(owner.address, beneficiary.address, 45);

				// owner release vested tokens (45)
				await expect(tokenVesting.connect(owner).release(vestingScheduleId, 45))
					.to.emit(testToken, "Transfer")
					.withArgs(owner.address, beneficiary.address, 45);
				vestingSchedule = await tokenVesting.getVestingSchedule(vestingScheduleId);

				// check that the number of released tokens is 110
				expect(vestingSchedule.released).to.be.equal(110);

				// check that the vested amount is 0
				expect(await tokenVesting.connect(beneficiary).computeReleasableAmount(vestingScheduleId)).to.be.equal(0);

				// check that anyone cannot revoke a vesting
				await expect(tokenVesting.connect(addr2).revoke(vestingScheduleId)).to.be.revertedWith(
					"Ownable: caller is not the owner"
				);
				await tokenVesting.revoke(vestingScheduleId);

				/*
				 * TEST SUMMARY
				 * deploy vesting contract
				 * send tokens to vesting contract
				 * create new vesting schedule (110 tokens, 10 available immediately after start)
				 * check that vested amount is 0 before start
				 * check that vested amount is 10 after start
				 * set time to half the vesting period
				 * check that vested amount is half the total amount to vest (10 immediate + 50 vested tokens)
				 * check that only beneficiary can try to release vested tokens
				 * check that beneficiary cannot release more than the vested amount
				 * release 20 tokens and check that a Transfer event is emitted with a value of 20
				 * check that the released amount is 20
				 * check that the vested amount is now 40
				 * set current time after the end of the vesting period
				 * check that the vested amount is 90 (110 - 20 released tokens)
				 * release all vested tokens (90)
				 * check that the number of released tokens is 110
				 * check that the vested amount is 0
				 * check that no one is able to revoke a vesting
				 */
			});

			it("Should not release vested tokens during revoke", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();
				expect((await tokenVesting.getToken()).toString()).to.equal(testToken.address);
				// approve tokens to be spent by vesting contract
				await expect(testToken.approve(tokenVesting.address, 1000))
					.to.emit(testToken, "Approval")
					.withArgs(owner.address, tokenVesting.address, 1000);

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 0;
				const duration = 1000;
				const slicePeriodSeconds = 1;
				const revocable = true;
				const amount = 100;

				// create new vesting schedule
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					0
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				// compute vesting schedule id
				const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);

				// set time to half the vesting period
				const halfTime = baseTime + duration / 2;
				await tokenVesting.setCurrentTime(halfTime);

				await expect(tokenVesting.revoke(vestingScheduleId)).to.not.emit(testToken, "Transfer");
				expect(await tokenVesting.getVestingSchedulesTotalAmount(), "incorrect vestingSchedulesTotalAmount")
					.to.equal(0);
			});

			it("Should not allow computing, releasing, revoking if already revoked or not initialized", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();

				await expect(tokenVesting.computeReleasableAmount("0x" + "0".repeat(64))).to.be.reverted;
				await expect(tokenVesting.revoke("0x" + "0".repeat(64))).to.be.reverted;
				await expect(tokenVesting.release("0x" + "0".repeat(64), 1)).to.be.reverted;

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 17;
				const duration = 1356;
				const slicePeriodSeconds = 3;
				const revocable = true;
				const amount = 1128;
				const immediatelyReleasableAmount = 38;

				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				// compute vesting schedule id
				const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
				// approve token transfer and revoke
				await testToken.approve(tokenVesting.address, amount);
				await tokenVesting.revoke(vestingScheduleId);

				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(0);
				await expect(tokenVesting.revoke(vestingScheduleId)).to.be.reverted;
				await expect(tokenVesting.release(vestingScheduleId, 1)).to.be.reverted;
			});

			it("Should not allow pausing if already paused, revoked or not initialized", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 17;
				const duration = 1356;
				const slicePeriodSeconds = 3;
				const revocable = true;
				const amount = 1128;
				const immediatelyReleasableAmount = 38;

				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				await expect(tokenVesting.setPaused("0x" + "0".repeat(64), true)).to.be.reverted;

				// compute vesting schedule id
				const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);

				await expect(tokenVesting.setPaused(vestingScheduleId, false)).to.be.reverted;
				tokenVesting.setPaused(vestingScheduleId, true);
				await expect(tokenVesting.setPaused(vestingScheduleId, true)).to.be.reverted;
				tokenVesting.setPaused(vestingScheduleId, false);

				// approve token transfer and revoke
				await testToken.approve(tokenVesting.address, amount);
				await tokenVesting.revoke(vestingScheduleId);

				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(0);
				await expect(tokenVesting.setPaused(vestingScheduleId, true)).to.be.reverted;
			});

			it("Should not allow releasing when paused", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 17;
				const duration = 1356;
				const slicePeriodSeconds = 3;
				const revocable = true;
				const amount = 1128;
				const immediatelyReleasableAmount = 38;

				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				// compute vesting schedule id
				const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
				// approve token transfer
				await testToken.approve(tokenVesting.address, amount);

				// set paused
				await tokenVesting.setPaused(vestingScheduleId, true)

				expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(0);
				await expect(tokenVesting.release(vestingScheduleId, 1)).to.be.reverted;
				await expect(tokenVesting.setPaused(vestingScheduleId, true)).to.be.reverted;
			});

			it("Should compute vesting schedule index", async function() {
				const tokenVesting = await deployment_fn();
				const expectedVestingScheduleId = "0xa279197a1d7a4b7398aa0248e95b8fcc6cdfb43220ade05d01add9c5468ea097";
				expect((await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0)).toString()).to.equal(
					expectedVestingScheduleId
				);
				expect((await tokenVesting.computeNextVestingScheduleIdForHolder(addr1.address)).toString()).to.equal(
					expectedVestingScheduleId
				);
			});

			it("Should check input parameters for createVestingSchedule method", async function() {
				const tokenVesting = await deployment_fn();
				const time = Date.now() / 1000 | 0;
				await expect(tokenVesting.createVestingSchedule(addr1.address, time, 0, 0, 1, false, 1, 0)).to.be.revertedWith(
					"TokenVesting: duration must be > 0"
				);
				await expect(tokenVesting.createVestingSchedule(addr1.address, time, 0, 1, 0, false, 1, 0)).to.be.revertedWith(
					"TokenVesting: slicePeriodSeconds must be >= 1"
				);
				await expect(tokenVesting.createVestingSchedule(addr1.address, time, 0, 1, 1, false, 0, 0)).to.be.revertedWith(
					"TokenVesting: amount must be > 0"
				);
				await expect(tokenVesting.createVestingSchedule(addr1.address, time, 0, 1, 1, false, 1, 2)).to.be.revertedWith(
					"TokenVesting: immediatelyReleasableAmount must be <= amount"
				);
			});

			it("V2 -> V3 Upgrade doesn't break VestingSchedule struct storage layout", async function() {
				// deploy vesting contract
				let tokenVesting = await deployment_fn();

				const baseTime = 1622551248;
				const beneficiary = addr1;
				const startTime = baseTime;
				const cliff = 17;
				const duration = 1356;
				const slicePeriodSeconds = 3;
				const revocable = true;
				const amount = 1128;
				const immediatelyReleasableAmount = 38;

				// create 4 vesting schedules playing with the start time and duration
				// which are located close to the free storage slot we're going to use for "paused" flag
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime + 1,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime,
					cliff,
					duration + 1,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);
				await tokenVesting.createVestingSchedule(
					beneficiary.address,
					startTime + 1,
					cliff,
					duration + 1,
					slicePeriodSeconds,
					revocable,
					amount,
					immediatelyReleasableAmount
				);

				// upgrade the vesting contract
				tokenVesting = await upgrade_fn(tokenVesting);

				// compute vesting schedule ids
				const vestingScheduleId0 = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
				const vestingScheduleId1 = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 1);
				const vestingScheduleId2 = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 2);
				const vestingScheduleId3 = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 3);

				// load vesting schedules data
				const vestingSchedule0 = await tokenVesting.getVestingSchedule(vestingScheduleId0);
				const vestingSchedule1 = await tokenVesting.getVestingSchedule(vestingScheduleId1);
				const vestingSchedule2 = await tokenVesting.getVestingSchedule(vestingScheduleId2);
				const vestingSchedule3 = await tokenVesting.getVestingSchedule(vestingScheduleId3);

				// make sure all 4 schedules have "paused" bit unset
				expect(vestingSchedule0.paused, "schedule0: paused slot damaged").to.be.false;
				expect(vestingSchedule1.paused, "schedule1: paused slot damaged").to.be.false;
				expect(vestingSchedule2.paused, "schedule2: paused slot damaged").to.be.false;
				expect(vestingSchedule3.paused, "schedule3: paused slot damaged").to.be.false;
			});
		});
	}
	run_test_suite(deploy_v2, upgrade_to_v3);
});