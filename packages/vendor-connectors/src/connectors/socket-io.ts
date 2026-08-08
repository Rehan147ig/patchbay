import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Socket.IO connector.
 *
 * Socket.IO v3 -> v4 protocol breaking changes:
 * - Default namespace behavior changed; `io.to(room).emit` semantics
 *   unchanged but the client `socket.io-client` had breaking API changes
 *   (`io()` vs `new Manager`).
 * - Event listener signature changes (v3 `socket.on('message', fn)` same,
 *   but binary/ack handling changed in v4).
 * - `socket.handshake` structure changed (auth, query, headers).
 */
export const socketIoConnector = defineConnector({
  slug: "socket.io",
  identifiers: ["socket.io", "socket.io-client", "socketio"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "socket.handshake.query",
      description: "Socket.IO v4 changed the handshake object shape (query, auth, headers nested).",
      affectedSymbols: ["socket.handshake", "io", "socket"],
      breaking: true,
      evidence: { sdk: "socket.io", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "OTHER",
      oldValue: "v3 -> v4 protocol",
      description:
        "The v3->v4 upgrade requires EIO=4; clients/servers on mismatched versions silently fail to connect.",
      affectedSymbols: ["io()", "new Server()", "socket.io-client"],
      breaking: true,
      evidence: { sdk: "socket.io" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "acknowledgement behavior",
      description:
        "Acknowledgement/ack handling changed; timeouts and error args differ between v3 and v4.",
      affectedSymbols: ["socket.emit", "socket.on"],
      breaking: false,
      evidence: { sdk: "socket.io" },
    },
  ],
  patchSuggestions: {
    "socket.handshake": {
      replacement: "socket.handshake",
      description:
        "Update handshake reads to the v4 shape: socket.handshake.auth / .query / .headers.",
      confidence: 80,
    },
  },
});
