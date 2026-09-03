// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title FinchRegistry
/// @notice The canonical public identity layer for the Finch network on
///         Robinhood Chain (4663). Finches and Nests register permissionlessly
///         with a manifest hash + URI; large data lives offchain and
///         content-addressed. Events carry everything — if finch.fun
///         disappeared, the registry is reconstructable from chain state.
contract FinchRegistry {
    enum Kind {
        FINCH,
        NEST
    }

    enum Status {
        ACTIVE,
        DEPRECATED,
        REVOKED
    }

    struct Record {
        address owner;
        Kind kind;
        Status status;
        uint64 version;
        uint64 updatedAt;
        bytes32 manifestHash;
        string manifestURI;
    }

    mapping(bytes32 => Record) private records;

    event Registered(
        bytes32 indexed id, address indexed owner, Kind indexed kind, bytes32 manifestHash, string manifestURI
    );
    event ManifestUpdated(bytes32 indexed id, uint64 version, bytes32 manifestHash, string manifestURI);
    event StatusChanged(bytes32 indexed id, Status status);
    event OwnerChanged(bytes32 indexed id, address indexed previousOwner, address indexed newOwner);

    error AlreadyRegistered();
    error NotRegistered();
    error NotOwner();
    error ZeroAddress();
    error EmptyManifest();

    modifier onlyOwnerOf(bytes32 id) {
        Record storage record = records[id];
        if (record.owner == address(0)) revert NotRegistered();
        if (record.owner != msg.sender) revert NotOwner();
        _;
    }

    /// @notice Permissionless registration. `id` is chosen by the publisher
    ///         (e.g. keccak256 of a namespaced handle) and must be unused.
    function register(bytes32 id, Kind kind, bytes32 manifestHash, string calldata manifestURI) external {
        if (records[id].owner != address(0)) revert AlreadyRegistered();
        if (manifestHash == bytes32(0)) revert EmptyManifest();
        records[id] = Record({
            owner: msg.sender,
            kind: kind,
            status: Status.ACTIVE,
            version: 1,
            updatedAt: uint64(block.timestamp),
            manifestHash: manifestHash,
            manifestURI: manifestURI
        });
        emit Registered(id, msg.sender, kind, manifestHash, manifestURI);
    }

    /// @notice Publish a new manifest version.
    function updateManifest(bytes32 id, bytes32 manifestHash, string calldata manifestURI)
        external
        onlyOwnerOf(id)
    {
        if (manifestHash == bytes32(0)) revert EmptyManifest();
        Record storage record = records[id];
        record.version += 1;
        record.updatedAt = uint64(block.timestamp);
        record.manifestHash = manifestHash;
        record.manifestURI = manifestURI;
        emit ManifestUpdated(id, record.version, manifestHash, manifestURI);
    }

    function setStatus(bytes32 id, Status status) external onlyOwnerOf(id) {
        Record storage record = records[id];
        record.status = status;
        record.updatedAt = uint64(block.timestamp);
        emit StatusChanged(id, status);
    }

    function transferRecord(bytes32 id, address newOwner) external onlyOwnerOf(id) {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = records[id].owner;
        records[id].owner = newOwner;
        records[id].updatedAt = uint64(block.timestamp);
        emit OwnerChanged(id, previous, newOwner);
    }

    function get(bytes32 id) external view returns (Record memory) {
        Record memory record = records[id];
        if (record.owner == address(0)) revert NotRegistered();
        return record;
    }

    function exists(bytes32 id) external view returns (bool) {
        return records[id].owner != address(0);
    }
}
