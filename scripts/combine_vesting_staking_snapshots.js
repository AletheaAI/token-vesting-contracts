/**
 * Enriches vesting snapshot with the data from staking snapshot
 *
 * Run: node ./scripts/combine_vesting_staking_snapshots.js
 *
 * Input(s): ./data/vesting_data.csv, ../alethea-staking/data/staking_data.csv
 * Output(s): ./data/vesting_data_enriched.csv
 */

// we will be writing CSV file with fs
const fs = require("fs");
// we need a path separator to create a dir
const path = require("path");

// we will asserts to validate some data constraints
const assert = require("node:assert");

// read vesting and staking data CSV files
const vestingData = fs.readFileSync("./data/vesting_data.csv", "utf8").split("\n");
assert(vestingData[0] === "scheduleId,initialized,revocable,revoked,beneficiary,cliff,start,duration,slicePeriodSeconds,amountTotal,immediatelyReleasableAmount,released", "unexpected CSV file header in vesting_data.csv");
const stakingData = fs.readFileSync("../alethea-staking/data/staking_data.csv", "utf8").split("\n");
assert(stakingData[0] === "address,staked,withdrawn,left,rewardsPaid");

// convert staking data into convenient map
const stakingMapping = stakingData
	// remove the header
	.slice(1)
	// parse each line into values array
	.map(line => line.split(","))
	// convert each array into mapping entry and combine into single map
	.reduce((map, array) => {
		// address is the mapping key
		map[array[0]] = array.slice(1);
		return map;
	}, {});

// enrich vesting data with the values from staking mapping
const enrichedVestingData = vestingData
	// remove the header
	.slice(1)
	// parse each line into values array
	.map(line => line.split(","))
	// sort by revoked: revoked entries should go last
	.sort((a, b) => ("true" === a[3]) - ("true" === b[3]))
	// enrich each array with the data from staking mapping
	.map(array => [...array, ...(stakingMapping[array[4]] || [0, 0, 0, 0])]);

// pick a CSV file name to write into
const csv_file = "./data/vesting_data_enriched.csv";

// create a dir if required
fs.mkdirSync(csv_file.substring(0, csv_file.lastIndexOf(path.sep)), {recursive: true});

// write a CSV data header first
fs.writeFileSync(
	csv_file,
	"scheduleId,initialized,revocable,revoked,beneficiary,cliff,start,duration,slicePeriodSeconds,amountTotal,immediatelyReleasableAmount,released,staked,withdrawn,left,rewardsPaid"
);

// write the data into CSV file
fs.appendFileSync(csv_file, "\n");
fs.appendFileSync(csv_file, enrichedVestingData.map(array => array.join(",")).join("\n"));


console.log("complete: %o records written into %o", enrichedVestingData.length, csv_file);
