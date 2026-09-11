// SPDX-License-Identifier: Apache-2.0 OR MIT
pragma solidity ^0.8.20;

/// Mirror of FilOzone/filecoin-services service_contracts/src/interfaces/IDataSetAuthorizer.sol.
interface IDataSetAuthorizer {
    function isAuthorized(
        uint256 dataSetId,
        address payer,
        bytes32 operation,
        bytes32 digest,
        bytes calldata signature,
        bytes calldata operationData
    ) external returns (bool authorized);
}

/// @title CooldownAuthorizer
/// @notice The smallest useful data set ACL for foc-collab: the payer may do
///         anything; any other secp256k1 key may AddPieces to the data set,
///         at most `maxPiecesPerOp` pieces per operation and no more than
///         once every `cooldownEpochs` epochs per signer. Nothing else is
///         allowed for non-payers (no removals, no termination).
/// @dev One instance can serve many data sets; state is per (data set, signer).
///      Only the warm storage service may ask, so the cooldown cannot be
///      burned by anyone calling isAuthorized directly.
contract CooldownAuthorizer is IDataSetAuthorizer {
    // keccak256 of the AddPieces EIP-712 type string, as in SignatureVerificationLib.
    bytes32 public constant ADD_PIECES_TYPEHASH = keccak256(
        "AddPieces(uint256 clientDataSetId,uint256 nonce,Cid[] pieceData,PieceMetadata[] pieceMetadata)"
        "Cid(bytes data)" "MetadataEntry(string key,string value)"
        "PieceMetadata(uint256 pieceIndex,MetadataEntry[] metadata)"
    );

    struct Cid {
        bytes data;
    }

    address public immutable warmStorage;
    uint256 public immutable cooldownEpochs;
    uint256 public immutable maxPiecesPerOp;

    /// dataSetId => signer => epoch of that signer's last accepted AddPieces
    mapping(uint256 => mapping(address => uint256)) public lastWrite;

    event Authorized(uint256 indexed dataSetId, address indexed signer, uint256 pieces);

    error NotWarmStorage(address caller);
    error BadSignatureLength(uint256 length);
    error BadSignatureV(uint8 v);

    constructor(address warmStorage_, uint256 cooldownEpochs_, uint256 maxPiecesPerOp_) {
        warmStorage = warmStorage_;
        cooldownEpochs = cooldownEpochs_;
        maxPiecesPerOp = maxPiecesPerOp_;
    }

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
        if (signer == address(0)) return false;
        if (signer == payer) return true;
        if (operation != ADD_PIECES_TYPEHASH) return false;

        (,, Cid[] memory pieces,,) = abi.decode(operationData, (uint256, uint256, Cid[], string[][], string[][]));
        if (pieces.length == 0 || pieces.length > maxPiecesPerOp) return false;

        uint256 last = lastWrite[dataSetId][signer];
        if (last != 0 && block.number < last + cooldownEpochs) return false;
        lastWrite[dataSetId][signer] = block.number;
        emit Authorized(dataSetId, signer, pieces.length);
        return true;
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
