// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CosmosPayIntents} from "../contracts/CosmosPayIntents.sol";

/// @dev Stand-in for USDC's ERC-20 interface on Arc: same 6 decimals, same
///      fixed address, placed there with `vm.etch` so the test exercises the
///      real constant rather than an injected one.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfers;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[from] >= value, "balance");
        require(allowance[from][msg.sender] >= value, "allowance");
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}

contract CosmosPayIntentsTest is Test {
    address constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000;

    CosmosPayIntents internal intents;
    MockUSDC internal usdc;

    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");

    bytes32 internal constant ID = keccak256("order-24");
    uint96 internal constant AMOUNT = 5_000_000; // 5 USDC, 6 decimals

    event IntentCreated(bytes32 indexed id, address indexed merchant, uint96 amount, string memo);
    event IntentPaid(bytes32 indexed id, address indexed payer, address indexed merchant, uint96 amount);

    function setUp() public {
        vm.etch(USDC_ADDRESS, address(new MockUSDC()).code);
        usdc = MockUSDC(USDC_ADDRESS);
        intents = new CosmosPayIntents();

        usdc.mint(payer, 100_000_000); // 100 USDC
        vm.prank(payer);
        usdc.approve(address(intents), type(uint256).max);
    }

    // ── create ──────────────────────────────────────────────────────────────

    function test_create_storesTheIntentAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit IntentCreated(ID, merchant, AMOUNT, "Order #24");

        vm.prank(merchant);
        intents.create(ID, AMOUNT, "Order #24");

        (address storedMerchant, uint96 amount, address storedPayer,,, bool paid) = intents.get(ID);
        assertEq(storedMerchant, merchant);
        assertEq(amount, AMOUNT);
        assertEq(storedPayer, address(0));
        assertFalse(paid);
    }

    function test_create_rejectsADuplicateId() public {
        vm.startPrank(merchant);
        intents.create(ID, AMOUNT, "first");
        vm.expectRevert(CosmosPayIntents.IdTaken.selector);
        intents.create(ID, AMOUNT, "second");
        vm.stopPrank();
    }

    function test_create_rejectsAZeroAmount() public {
        vm.prank(merchant);
        vm.expectRevert(CosmosPayIntents.AmountRequired.selector);
        intents.create(ID, 0, "free");
    }

    // ── pay ─────────────────────────────────────────────────────────────────

    function test_pay_movesUsdcToTheMerchantAndEmits() public {
        vm.prank(merchant);
        intents.create(ID, AMOUNT, "Order #24");

        vm.expectEmit(true, true, true, true);
        emit IntentPaid(ID, payer, merchant, AMOUNT);

        vm.prank(payer);
        intents.pay(ID);

        assertEq(usdc.balanceOf(merchant), AMOUNT, "merchant was paid");
        assertEq(usdc.balanceOf(payer), 100_000_000 - AMOUNT, "payer was debited");

        (,, address storedPayer,, uint40 paidAt, bool paid) = intents.get(ID);
        assertEq(storedPayer, payer);
        assertTrue(paid);
        assertEq(paidAt, uint40(block.timestamp));
    }

    /// @dev The contract is a router, not an escrow: nothing may stay behind.
    function test_pay_leavesNoBalanceInTheContract() public {
        vm.prank(merchant);
        intents.create(ID, AMOUNT, "Order #24");
        vm.prank(payer);
        intents.pay(ID);
        assertEq(usdc.balanceOf(address(intents)), 0);
    }

    function test_pay_rejectsAnUnknownIntent() public {
        vm.prank(payer);
        vm.expectRevert(CosmosPayIntents.UnknownIntent.selector);
        intents.pay(keccak256("never-created"));
    }

    function test_pay_rejectsASecondPayment() public {
        vm.prank(merchant);
        intents.create(ID, AMOUNT, "Order #24");
        vm.prank(payer);
        intents.pay(ID);

        address second = makeAddr("second");
        usdc.mint(second, AMOUNT);
        vm.startPrank(second);
        usdc.approve(address(intents), AMOUNT);
        vm.expectRevert(CosmosPayIntents.AlreadyPaid.selector);
        intents.pay(ID);
        vm.stopPrank();
    }

    /// @dev A token that reports failure instead of reverting must not leave the
    ///      intent marked as paid.
    function test_pay_revertsWhenTheTransferReportsFailure() public {
        vm.prank(merchant);
        intents.create(ID, AMOUNT, "Order #24");
        usdc.setFailTransfers(true);

        vm.prank(payer);
        vm.expectRevert(CosmosPayIntents.TransferFailed.selector);
        intents.pay(ID);

        (,, address storedPayer,,, bool paid) = intents.get(ID);
        assertEq(storedPayer, address(0), "payer was rolled back");
        assertFalse(paid);
    }

    function test_pay_revertsWhenThePayerIsShort() public {
        vm.prank(merchant);
        intents.create(ID, 200_000_000, "too much"); // 200 USDC, payer holds 100

        vm.prank(payer);
        vm.expectRevert(bytes("balance"));
        intents.pay(ID);
    }

    // ── views ───────────────────────────────────────────────────────────────

    function test_get_revertsForAnUnknownIntent() public {
        vm.expectRevert(CosmosPayIntents.UnknownIntent.selector);
        intents.get(keccak256("never-created"));
    }

    function test_canPay_reportsWhatIsMissing() public {
        vm.prank(merchant);
        intents.create(ID, AMOUNT, "Order #24");

        address broke = makeAddr("broke");
        (bool enoughBalance, bool enoughAllowance) = intents.canPay(ID, broke);
        assertFalse(enoughBalance);
        assertFalse(enoughAllowance);

        usdc.mint(broke, AMOUNT);
        (enoughBalance, enoughAllowance) = intents.canPay(ID, broke);
        assertTrue(enoughBalance, "balance arrived");
        assertFalse(enoughAllowance, "still no allowance");

        vm.prank(broke);
        usdc.approve(address(intents), AMOUNT);
        (, enoughAllowance) = intents.canPay(ID, broke);
        assertTrue(enoughAllowance);
    }

    // ── fuzz ────────────────────────────────────────────────────────────────

    function testFuzz_payMovesExactlyTheAmount(uint96 amount, bytes32 id) public {
        amount = uint96(bound(amount, 1, 50_000_000));
        vm.assume(id != bytes32(0));

        vm.prank(merchant);
        intents.create(id, amount, "fuzz");

        uint256 before = usdc.balanceOf(merchant);
        vm.prank(payer);
        intents.pay(id);

        assertEq(usdc.balanceOf(merchant) - before, amount);
    }
}
