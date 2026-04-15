import { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';

export interface DeviceNode {
  id: string;
  socket: WebSocket;
  capabilities: string[];
  registeredAt: string;
  lastSeen: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout;
}

class NodeManager {
  private nodes: Map<string, DeviceNode> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();

  /**
   * Registers a new device node.
   */
  registerNode(socket: WebSocket, nodeId: string, capabilities: string[]): DeviceNode {
    const node: DeviceNode = {
      id: nodeId || uuid(),
      socket,
      capabilities,
      registeredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    this.nodes.set(node.id, node);
    console.log(`📡 Node registered: ${node.id} with capabilities: ${capabilities.join(', ')}`);
    return node;
  }

  /**
   * Removes a node by its socket.
   */
  unregisterNodeBySocket(socket: WebSocket) {
    for (const [id, node] of this.nodes.entries()) {
      if (node.socket === socket) {
        this.nodes.delete(id);
        console.log(`🔌 Node disconnected: ${id}`);
        
        // Fail all pending requests for this node
        // (Simplified: we'd need to track which request belongs to which node)
        break;
      }
    }
  }

  /**
   * Gets a node by its ID.
   */
  getNode(nodeId: string): DeviceNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Returns all registered nodes.
   */
  listNodes(): DeviceNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Invokes a command on a node and waits for the response.
   */
  async invokeNode(nodeId: string, action: string, params: any): Promise<any> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} nicht gefunden. Ist das Gerät verbunden?`);
    }

    if (node.socket.readyState !== 1) { // 1 = OPEN
      throw new Error(`Node ${nodeId} Verbindung ist nicht offen.`);
    }

    const requestId = uuid();
    const message = JSON.stringify({
      type: 'node.invoke',
      requestId,
      action,
      params,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Timeout: Gerät ${nodeId} hat nicht rechtzeitig geantwortet.`));
        }
      }, 15000); // 15s timeout for remote actions

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      try {
        node.socket.send(message);
        console.log(`📤 Command sent to ${nodeId}: ${action} (Req: ${requestId})`);
      } catch (err) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  /**
   * Handles a response received from a device node.
   */
  handleResponse(payload: any) {
    const { requestId, status, result, error } = payload;
    const pending = this.pendingRequests.get(requestId);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);

      if (status === 'success') {
        pending.resolve(result);
      } else {
        pending.reject(new Error(error || 'Unbekannter Fehler auf dem Endgerät'));
      }
    }
  }
}

export const nodeManager = new NodeManager();
