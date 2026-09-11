// SPDX-License-Identifier: Apache-2.0 OR MIT
pragma solidity ^0.8.20;

import {ArcadeAuthorizer} from "../src/ArcadeAuthorizer.sol";

/// Plain forge tests (no forge-std): a failing test reverts.
contract ArcadeAuthorizerTest {
    ArcadeAuthorizer a;

    function setUp() public {
        a = new ArcadeAuthorizer(address(this), ArcadeAuthorizer.Policy(4, 1, 100, 2880, 10, false));
    }

    // bafkzcibcaabgxwgjgjp67szvksekbkcskjsegdphgf6gpbepmufyc24vlnsu4di: a 127-byte piece, height 2
    function testHeightOfRealCid() public view {
        bytes memory cid = hex"015591202200026bd8c9325fefcb355488a0a8525264430de7317c67848f650b816b955b654e0d";
        (bool ok, uint8 h) = a.pieceHeight(cid);
        require(ok, "parse");
        require(h == 2, "height");
    }

    function testHeightWithTwoBytePaddingVarint() public view {
        // padding varint 0x8101 (=129), height 30, digest size 2+1+32 = 35 (0x23)
        bytes memory cid = abi.encodePacked(hex"0155912023" , hex"8101", hex"1e", new bytes(32));
        (bool ok, uint8 h) = a.pieceHeight(cid);
        require(ok, "parse");
        require(h == 30, "height");
    }

    function testRejectsWrongShapes() public view {
        (bool ok,) = a.pieceHeight(hex"0155");
        require(!ok, "short");
        (ok,) = a.pieceHeight(hex"0055912022000200000000000000000000000000000000000000000000000000000000000000000000");
        require(!ok, "not cid v1");
        (ok,) = a.pieceHeight(hex"01551220000000000000000000000000000000000000000000000000000000000000000000000000");
        require(!ok, "sha256 not commp");
        (ok,) = a.pieceHeight(hex"01559120220002ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00");
        require(!ok, "length mismatch");
    }
}
