// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 surface. On Arc, USDC is the gas token and also
///         exposes this interface at a fixed address, with 6 decimals.
interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/// @title  Cosmos Pay payment intents on Arc
/// @notice The same object Cosmos Pay uses on Stellar (a payment intent: who
///         charges, how much, and whether it was paid), expressed on Arc so a
///         merchant can be paid in USDC and anyone can verify it on-chain.
///
///         The contract never holds funds: `pay` moves USDC straight from the
///         payer to the merchant and records that the intent is settled. A
///         receipt is therefore one transfer plus one event, not a balance
///         sitting in an escrow nobody audits.
contract CosmosPayIntents {
    /// @dev USDC's ERC-20 interface on Arc, mainnet and testnet alike.
    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    struct Intent {
        address merchant;
        uint96 amount; // USDC has 6 decimals, so this holds ~79 trillion units
        address payer; // zero until paid
        uint40 createdAt;
        uint40 paidAt;
    }

    mapping(bytes32 => Intent) private _intents;

    event IntentCreated(bytes32 indexed id, address indexed merchant, uint96 amount, string memo);
    event IntentPaid(bytes32 indexed id, address indexed payer, address indexed merchant, uint96 amount);

    error IdTaken();
    error UnknownIntent();
    error AlreadyPaid();
    error AmountRequired();
    error TransferFailed();

    /// @notice Open an intent. The id is chosen by the caller so a wallet can
    ///         derive it from its own payment reference instead of waiting for
    ///         a receipt to learn it.
    /// @param id     Unique reference for this charge
    /// @param amount Amount in USDC's smallest unit (6 decimals)
    /// @param memo   What the charge is for; kept in the log, not in storage
    function create(bytes32 id, uint96 amount, string calldata memo) external {
        if (amount == 0) revert AmountRequired();
        if (_intents[id].merchant != address(0)) revert IdTaken();

        _intents[id] = Intent({
            merchant: msg.sender, amount: amount, payer: address(0), createdAt: uint40(block.timestamp), paidAt: 0
        });

        emit IntentCreated(id, msg.sender, amount, memo);
    }

    /// @notice Pay an open intent. The payer must have approved this contract
    ///         for at least `amount` first, the usual ERC-20 two-step.
    function pay(bytes32 id) external {
        Intent storage intent = _intents[id];
        if (intent.merchant == address(0)) revert UnknownIntent();
        if (intent.payer != address(0)) revert AlreadyPaid();

        intent.payer = msg.sender;
        intent.paidAt = uint40(block.timestamp);

        if (!USDC.transferFrom(msg.sender, intent.merchant, intent.amount)) revert TransferFailed();

        emit IntentPaid(id, msg.sender, intent.merchant, intent.amount);
    }

    /// @notice Everything a client needs to render a receipt, in one call.
    function get(bytes32 id)
        external
        view
        returns (address merchant, uint96 amount, address payer, uint40 createdAt, uint40 paidAt, bool paid)
    {
        Intent memory intent = _intents[id];
        if (intent.merchant == address(0)) revert UnknownIntent();
        return
            (intent.merchant, intent.amount, intent.payer, intent.createdAt, intent.paidAt, intent.payer != address(0));
    }

    /// @notice Whether the payer is ready to settle this intent: enough balance
    ///         and enough allowance. Lets a page say what is missing before it
    ///         sends a transaction that would revert.
    function canPay(bytes32 id, address payer) external view returns (bool enoughBalance, bool enoughAllowance) {
        Intent memory intent = _intents[id];
        if (intent.merchant == address(0)) revert UnknownIntent();
        return (USDC.balanceOf(payer) >= intent.amount, USDC.allowance(payer, address(this)) >= intent.amount);
    }
}
