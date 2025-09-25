import * as types from "./types";
import * as wireguard from "./wireguard";
import * as pulumi from "@pulumi/pulumi";

export type HubArgs = {
  node: types.Node;
  address: wireguard.IPv4Address;
  allowedIPs?: wireguard.IPv4Address[];
};

export class Hub extends pulumi.ComponentResource {
  name: string;
  node: types.Node;
  peer: wireguard.Peer;
  keyPair: wireguard.KeyPair;

  constructor(
    name: string,
    hubArgs: HubArgs,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("vpn:hub", name, {}, opts);

    this.name = name;
    this.node = hubArgs.node;

    const n = types.nameMaker(name);

    const childInfo = pulumi.mergeOptions(opts, { parent: this });

    this.keyPair = new wireguard.KeyPair(n("keyPair"), {}, childInfo);

    const peerArgs = {
      listenPort: wireguard.info.publicPort,
      address: [hubArgs.address],
      endpoint: pulumi
        .output(this.node.connection.host)
        .apply((h) => `${h}:${wireguard.info.publicPort}`),
      connection: this.node.connection,
      keyPair: this.keyPair,
      allowedIPs: hubArgs.allowedIPs,
      enableForwarding: true,
    };

    this.peer = new wireguard.Peer(
      n("peer"),
      peerArgs,
      pulumi.mergeOptions(childInfo, { dependsOn: [this.node] }),
    );
  }
}

export type SpokeArgs = {
  address: pulumi.Input<wireguard.IPv4Address>;
};

export class Spoke
  extends pulumi.ComponentResource
  implements wireguard.OtherPeer
{
  name: string;
  keyPair: wireguard.KeyPair;
  address: pulumi.Input<wireguard.IPv4Address>[];

  constructor(
    name: string,
    spokeArgs: SpokeArgs,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("vpn:spoke", name, {}, opts);

    this.name = name;

    const n = types.nameMaker(name);

    const childInfo = pulumi.mergeOptions(opts, { parent: this });

    this.keyPair = new wireguard.KeyPair(n("keyPair"), {}, childInfo);

    this.address = [spokeArgs.address];
  }
}

export type CoordinatorArgs = object;

export class Coordinator extends pulumi.ComponentResource {
  name: string;
  hubs: Hub[] = [];
  spokes: Spoke[] = [];
  childInfo: pulumi.ComponentResourceOptions;

  constructor(
    name: string,
    args: CoordinatorArgs = {},
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("vpn:coordinator", name, args, opts);
    this.name = name;
    this.childInfo = pulumi.mergeOptions(opts, { parent: this });
  }

  addHub(node: types.Node) {
    const hub = new Hub(
      node.name,
      {
        node,
        address: {
          address: `10.169.0.${this.hubs.length + 1}`,
          netmask: "16",
        },
        allowedIPs: [
          {
            address: `10.169.0.0`,
            netmask: "16",
          },
        ],
      },
      this.childInfo,
    );

    this.hubs.push(hub);
    return hub;
  }

  addSpoke(name: string) {
    const spoke = new Spoke(
      `spoke-${name}`,
      {
        address: {
          address: `10.169.${this.spokes.length + 1}.1`,
          netmask: "16",
        },
      },
      this.childInfo,
    );

    this.spokes.push(spoke);
    return spoke;
  }

  spokeConfig() {
    return this.spokes.map((s) => ({
      name: s.name,
      address: s.address,
      keyPair: {
        privateKey: s.keyPair.privateKey,
        publicKey: s.keyPair.publicKey,
      },
      peers: this.hubs.map((h) => ({
        address: h.peer.address,
        endpoint: h.peer.endpoint,
        keyPair: {
          publicKey: h.keyPair.publicKey,
        },
        allowedIPs: h.peer.allowedIPs,
      })),
    }));
  }

  configureHubs() {
    return this.hubs.map((hub) => {
      const otherPeers = this.hubs.filter((n) => n !== hub).map((h) => h.peer);
      return hub.peer.setupHost([
        ...otherPeers,
        ...this.spokes,
      ] as wireguard.OtherPeer[]);
    });
  }
}
