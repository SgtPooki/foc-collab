// SPDX-License-Identifier: Apache-2.0 OR MIT
pragma solidity ^0.8.20;

import {IDataSetAuthorizer} from "./CooldownAuthorizer.sol";

/// @title ArcadeAuthorizer
/// @notice The write policy for a sponsored data set: the payer may do
///         anything; anyone else may only AddPieces, and only within
///         limits the owner can tune without redeploying:
///           - per-signer cooldown (epochs between a signer's writes)
///           - per-operation piece count cap
///           - a global budget: at most `budgetPerWindow` pieces per
///             `windowEpochs` across all signers, so one data set's spend
///             is bounded whatever the crowd does
///           - a blocklist and a pause switch
///         State is per data set, so one instance serves many.
/// @dev Signer recovery is secp256k1 today. The signature arrives as raw
///      bytes from the warm storage service, so a P-256 or WebAuthn path
///      can be added behind `recover` without changing the interface.
///      Only the warm storage service may call isAuthorized; a direct call
///      cannot burn anyone's cooldown or budget.
contract ArcadeAuthorizer is IDataSetAuthorizer {
    bytes32 public constant ADD_PIECES_TYPEHASH = keccak256(
        "AddPieces(uint256 clientDataSetId,uint256 nonce,Cid[] pieceData,PieceMetadata[] pieceMetadata)"
        "Cid(bytes data)" "MetadataEntry(string key,string value)"
        "PieceMetadata(uint256 pieceIndex,MetadataEntry[] metadata)"
    );

    struct Cid {
        bytes data;
    }

    struct Policy {
        uint64 cooldownEpochs;
        uint64 maxPiecesPerOp;
        uint64 budgetPerWindow;
        uint64 windowEpochs;
        bool paused;
    }

    struct Window {
        uint256 startEpoch;
        uint256 used;
    }

    address public immutable warmStorage;
    address public owner;
    Policy public policy;

    /// dataSetId => signer => epoch of that signer's last accepted AddPieces
    mapping(uint256 => mapping(address => uint256)) public lastWrite;
    /// dataSetId => the current budget window
    mapping(uint256 => Window) public windows;
    /// signer => blocked
    mapping(address => bool) public blocked;

    event Authorized(uint256 indexed dataSetId, address indexed signer, uint256 pieces, uint256 windowUsed);
    event PolicySet(uint64 cooldownEpochs, uint64 maxPiecesPerOp, uint64 budgetPerWindow, uint64 windowEpochs, bool paused);
    event Blocked(address indexed signer, bool blocked);
    event OwnerSet(address indexed owner);

    error NotOwner(address caller);
    error NotWarmStorage(address caller);
    error BadSignatureLength(uint256 length);
    error BadSignatureV(uint8 v);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor(address warmStorage_, Policy memory policy_) {
        warmStorage = warmStorage_;
        owner = msg.sender;
        policy = policy_;
        emit OwnerSet(msg.sender);
        emit PolicySet(policy_.cooldownEpochs, policy_.maxPiecesPerOp, policy_.budgetPerWindow, policy_.windowEpochs, policy_.paused);
    }

    // ------------------------------------------------------------ owner

    function setPolicy(Policy calldata policy_) external onlyOwner {
        policy = policy_;
        emit PolicySet(policy_.cooldownEpochs, policy_.maxPiecesPerOp, policy_.budgetPerWindow, policy_.windowEpochs, policy_.paused);
    }

    function setPaused(bool paused) external onlyOwner {
        policy.paused = paused;
        emit PolicySet(policy.cooldownEpochs, policy.maxPiecesPerOp, policy.budgetPerWindow, policy.windowEpochs, paused);
    }

    function setBlocked(address signer, bool isBlocked) external onlyOwner {
        blocked[signer] = isBlocked;
        emit Blocked(signer, isBlocked);
    }

    function setOwner(address owner_) external onlyOwner {
        owner = owner_;
        emit OwnerSet(owner_);
    }

    // ------------------------------------------------------------ policy

    function isAuthorized(
        uint256 dataSetId,
        address payer,
        bytes32 operation,
        bytes32 digest,
        bytes calldata signature,
        bytes calldata operationData
    ) external returns (bool) {
        if (msg.sender != warmStorage) revert NotWarmStorage(msg.sender);
        address signer = recover(digest, signature);
        // A false return makes the warm storage service revert the whole
        // operation, so there is nothing to log on refusal.
        if (signer == address(0)) return false;
        if (signer == payer) return true;
        if (operation != ADD_PIECES_TYPEHASH) return false;

        Policy memory p = policy;
        if (p.paused) return false;
        if (blocked[signer]) return false;

        (,, Cid[] memory pieces,,) = abi.decode(operationData, (uint256, uint256, Cid[], string[][], string[][]));
        if (pieces.length == 0 || pieces.length > p.maxPiecesPerOp) return false;

        uint256 last = lastWrite[dataSetId][signer];
        if (last != 0 && block.number < last + p.cooldownEpochs) return false;

        Window storage w = windows[dataSetId];
        if (w.startEpoch == 0 || block.number >= w.startEpoch + p.windowEpochs) {
            w.startEpoch = block.number;
            w.used = 0;
        }
        if (w.used + pieces.length > p.budgetPerWindow) return false;

        w.used += pieces.length;
        lastWrite[dataSetId][signer] = block.number;
        emit Authorized(dataSetId, signer, pieces.length, w.used);
        return true;
    }

    /// Pieces still allowed in the current window for `dataSetId` (a view for pages).
    function budgetLeft(uint256 dataSetId) external view returns (uint256) {
        Window memory w = windows[dataSetId];
        if (w.startEpoch == 0 || block.number >= w.startEpoch + policy.windowEpochs) return policy.budgetPerWindow;
        return w.used >= policy.budgetPerWindow ? 0 : policy.budgetPerWindow - w.used;
    }

    /// The epoch from which `signer` may write to `dataSetId` again.
    function nextWriteEpoch(uint256 dataSetId, address signer) external view returns (uint256) {
        uint256 last = lastWrite[dataSetId][signer];
        return last == 0 ? block.number : last + policy.cooldownEpochs;
    }

    /// Same (v, r, s) handling as SignatureVerificationLib.recoverSigner.
    function recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert BadSignatureLength(signature.length);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert BadSignatureV(v);
        return ecrecover(digest, v, r, s);
    }
}
