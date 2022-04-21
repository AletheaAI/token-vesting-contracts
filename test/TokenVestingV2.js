const { expect } = require("chai");

describe("TokenVestingV2", function () {
	let Token;
	const totalSupply = 1000000;
	let testToken;
	let TokenVesting;
	let Proxy;
	let owner;
	let addr1;
	let addr2;
	let addrs;

	before(async function () {
		Token = await ethers.getContractFactory("Token");
		TokenVesting = await ethers.getContractFactory("MockTokenVestingV2");
		Proxy = await ethers.getContractFactory("ERC1967Proxy");
	});
	beforeEach(async function () {
		[owner, addr1, addr2, ...addrs] = await ethers.getSigners();
		testToken = await Token.deploy("Test Token", "TT", totalSupply);
		await testToken.deployed();
	});

	describe("Vesting", function () {
		async function deploy() {
			const tokenVesting = await TokenVesting.deploy();
			await tokenVesting.postConstruct(testToken.address, owner.address);
			await tokenVesting.deployed();
			return tokenVesting;
		}

		it("Should assign the total supply of tokens to the owner", async function () {
			const ownerBalance = await testToken.balanceOf(owner.address);
			expect(await testToken.totalSupply()).to.equal(ownerBalance);
		});

		it("Should set token address correctly", async function () {
			// deploy vesting contract
			const tokenVesting = await deploy();
			expect((await tokenVesting.getToken()).toString()).to.equal(testToken.address);
		});

		it("Should set treasury address correctly", async function () {
			// deploy vesting contract
			const tokenVesting = await deploy();
			expect((await tokenVesting.getTreasury()).toString()).to.equal(owner.address);
		});

		it("Should update treasury address correctly", async function () {
			// deploy vesting contract
			const tokenVesting = await deploy();
			await tokenVesting.setTreasury(addr1.address);
			expect((await tokenVesting.getTreasury()).toString()).to.equal(addr1.address);
		});

		it("Should create vesting schedule correctly", async function () {
			// deploy vesting contract
			const tokenVesting = await deploy();

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
			const tokenVesting = await deploy();

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

		it("Should vest tokens gradually", async function () {
			// deploy vesting contract
			const tokenVesting = await deploy();
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

		it("Should vest tokens gradually when immediatelyReleasableAmount is set", async function () {
			// deploy vesting contract
			const tokenVesting = await deploy();
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

		it("Should not release vested tokens if revoked", async function () {
			// deploy vesting contract
			const tokenVesting = await deploy();
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

			// compute vesting schedule id
			const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);

			// set time to half the vesting period
			const halfTime = baseTime + duration / 2;
			await tokenVesting.setCurrentTime(halfTime);

			await expect(tokenVesting.revoke(vestingScheduleId)).to.not.emit(testToken, "Transfer");
			expect(await tokenVesting.getVestingSchedulesTotalAmount(), "incorrect vestingSchedulesTotalAmount")
				.to.equal(0);
		});

		it("Should not allow computing, releasing, revoking if already revoked or not initialized", async function () {
			// deploy vesting contract
			const tokenVesting = await deploy();

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

			// compute vesting schedule id
			const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
			// approve token transfer and revoke
			await testToken.approve(tokenVesting.address, amount);
			await tokenVesting.revoke(vestingScheduleId);

			expect(await tokenVesting.computeReleasableAmount(vestingScheduleId)).to.be.equal(0);
			await expect(tokenVesting.revoke(vestingScheduleId)).to.be.reverted;
			await expect(tokenVesting.release(vestingScheduleId, 1)).to.be.reverted;
		});

		it("Should compute vesting schedule index", async function () {
			const tokenVesting = await deploy();
			const expectedVestingScheduleId = "0xa279197a1d7a4b7398aa0248e95b8fcc6cdfb43220ade05d01add9c5468ea097";
			expect((await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0)).toString()).to.equal(
				expectedVestingScheduleId
			);
			expect((await tokenVesting.computeNextVestingScheduleIdForHolder(addr1.address)).toString()).to.equal(
				expectedVestingScheduleId
			);
		});

		it("Should check input parameters for createVestingSchedule method", async function () {
			const tokenVesting = await deploy();
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
	});
});
