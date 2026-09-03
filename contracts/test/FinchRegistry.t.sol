// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FinchRegistry} from "../src/FinchRegistry.sol";

contract FinchRegistryTest is Test {
    FinchRegistry internal registry;

    address internal publisher = makeAddr("publisher");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant ID = keccak256("finch:pons-scout");
    bytes32 internal constant HASH_V1 = keccak256("manifest-v1");
    bytes32 internal constant HASH_V2 = keccak256("manifest-v2");

    function setUp() public {
        registry = new FinchRegistry();
    }

    function test_registerAndRead() public {
        vm.prank(publisher);
        registry.register(ID, FinchRegistry.Kind.FINCH, HASH_V1, "ipfs://manifest-v1");

        FinchRegistry.Record memory record = registry.get(ID);
        assertEq(record.owner, publisher);
        assertEq(uint8(record.kind), uint8(FinchRegistry.Kind.FINCH));
        assertEq(uint8(record.status), uint8(FinchRegistry.Status.ACTIVE));
        assertEq(record.version, 1);
        assertEq(record.manifestHash, HASH_V1);
        assertTrue(registry.exists(ID));
    }

    function test_duplicateIdReverts() public {
        vm.prank(publisher);
        registry.register(ID, FinchRegistry.Kind.FINCH, HASH_V1, "ipfs://a");
        vm.prank(stranger);
        vm.expectRevert(FinchRegistry.AlreadyRegistered.selector);
        registry.register(ID, FinchRegistry.Kind.NEST, HASH_V1, "ipfs://b");
    }

    function test_updateBumpsVersion_onlyOwner() public {
        vm.prank(publisher);
        registry.register(ID, FinchRegistry.Kind.FINCH, HASH_V1, "ipfs://a");

        vm.prank(stranger);
        vm.expectRevert(FinchRegistry.NotOwner.selector);
        registry.updateManifest(ID, HASH_V2, "ipfs://b");

        vm.prank(publisher);
        registry.updateManifest(ID, HASH_V2, "ipfs://b");
        FinchRegistry.Record memory record = registry.get(ID);
        assertEq(record.version, 2);
        assertEq(record.manifestHash, HASH_V2);
    }

    function test_statusAndTransfer() public {
        vm.prank(publisher);
        registry.register(ID, FinchRegistry.Kind.NEST, HASH_V1, "ipfs://a");

        vm.prank(publisher);
        registry.setStatus(ID, FinchRegistry.Status.DEPRECATED);
        assertEq(uint8(registry.get(ID).status), uint8(FinchRegistry.Status.DEPRECATED));

        vm.prank(publisher);
        registry.transferRecord(ID, stranger);
        assertEq(registry.get(ID).owner, stranger);

        vm.prank(publisher);
        vm.expectRevert(FinchRegistry.NotOwner.selector);
        registry.setStatus(ID, FinchRegistry.Status.ACTIVE);
    }

    function test_emptyManifestReverts() public {
        vm.prank(publisher);
        vm.expectRevert(FinchRegistry.EmptyManifest.selector);
        registry.register(ID, FinchRegistry.Kind.FINCH, bytes32(0), "ipfs://a");
    }

    function test_unregisteredReadsRevert() public {
        vm.expectRevert(FinchRegistry.NotRegistered.selector);
        registry.get(ID);
        assertFalse(registry.exists(ID));
    }
}
