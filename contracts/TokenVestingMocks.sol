// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.11;

import "./TokenVesting.sol";
import "./TokenVestingV2.sol";
import "./TokenVestingV3.sol";

/**
 * @title MockTokenVesting
 * WARNING: use only for testing and debugging purpose
 */
contract MockTokenVesting is TokenVesting {

	uint256 mockTime = 0;

	function setCurrentTime(uint256 _time) external {
		mockTime = _time;
	}

	function getCurrentTime() internal virtual override view returns (uint256) {
		return mockTime;
	}
}

/**
 * @title MockTokenVestingV2
 * WARNING: use only for testing and debugging purpose
 */
contract MockTokenVestingV2 is TokenVestingV2 {

	uint256 mockTime = 0;

	function setCurrentTime(uint256 _time) external {
		mockTime = _time;
	}

	function getCurrentTime() internal virtual override view returns (uint256) {
		return mockTime;
	}
}

/**
 * @title MockTokenVestingV3
 * WARNING: use only for testing and debugging purpose
 */
contract MockTokenVestingV3 is TokenVestingV3 {

	uint256 mockTime = 0;

	function setCurrentTime(uint256 _time) external {
		mockTime = _time;
	}

	function getCurrentTime() internal virtual override view returns (uint256) {
		return mockTime;
	}
}
