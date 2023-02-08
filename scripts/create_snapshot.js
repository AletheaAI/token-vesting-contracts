/**
 * Takes a snapshot of all the vesting schedules, including revoked ones
 *
 * Run: npx hardhat run ./scripts/create_snapshot.js --network mainnet
 *
 * Input(s): None (all the required data is taken from deployments/network)
 * Output(s): ./data/vesting_data.csv file created in the project root
 */


// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
const hre = require("hardhat");

// we will be writing CSV file with fs
const fs = require('fs');
// we need a path separator to create a dir
const path = require('path')

// we're going to use async/await programming style, therefore we put
// all the logic into async main and execute it in the end of the file
// see https://javascript.plainenglish.io/writing-asynchronous-programs-in-javascript-9a292570b2a6
async function main() {
	// get the deployment address and abi
	const {address} = await hre.deployments.get("TokenVesting_Proxy");
	// proxy doesn't have the right ABI, we need to get it from the impl
	const {abi} = await hre.deployments.get("TokenVesting_v2");

	// construct the web3 contract from the above
	const web3_contract = new web3.eth.Contract(abi, address);

	// to iterate all the vesting schedules get their total amount first
	const length = await web3_contract.methods.getVestingSchedulesCount().call();

	// no need to proceed if there are no vesting schedules to iterate
	if(length <= 0) {
		console.log("no vesting schedules found in %o", address);
		return;
	}
	else {
		console.log("%o vesting schedules found in %o", length, address);
	}

	// pick a CSV file name to write into
	const csv_file = "./data/vesting_data.csv";

	// create a dir if required
	fs.mkdirSync(csv_file.substring(0, csv_file.lastIndexOf(path.sep)), {recursive: true});

	// write a CSV data header first
	fs.writeFileSync(
		csv_file,
		"scheduleId,initialized,revocable,revoked,beneficiary,cliff,start,duration,slicePeriodSeconds,amountTotal,immediatelyReleasableAmount,released"
	);

	// iterate over the schedules
	for(let i = 0; i < length; i++) {
		// to read the schedule data we get the vesting ID first
		const vestingId = await web3_contract.methods.getVestingIdAtIndex(i).call();
		// now read the vesting data
		const vestingData = await web3_contract.methods.getVestingSchedule(vestingId).call();

		// write the data line into CSV file
		fs.appendFileSync(csv_file, "\n");
		fs.appendFileSync(csv_file, vestingId);
		fs.appendFileSync(csv_file, ",");
		fs.appendFileSync(csv_file, vestingData.join(","));

		// tell something to a user for a better responsiveness
		console.log("%o of %o records written into %o", i, length, csv_file);
	}

	console.log("complete: %o records written into %o", length, csv_file);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
	.then(() => process.exit(0))
	.catch(err => {
		console.error(err);
		process.exit(1);
	});
