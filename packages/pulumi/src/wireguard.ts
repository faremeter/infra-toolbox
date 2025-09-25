/* eslint-disable @typescript-eslint/no-empty-object-type */
import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import * as crypto from "crypto";
import * as types from "./types";

export const info = {
  publicPort: 55121,
};

export interface KeyPairInputs {}

interface KeyPairProviderInputs {}

class KeyPairProvider implements pulumi.dynamic.ResourceProvider {
  async create(_: KeyPairProviderInputs): Promise<pulumi.dynamic.CreateResult> {
    const key = crypto.generateKeyPairSync("x25519", {
      publicKeyEncoding: { format: "der", type: "spki" },
      privateKeyEncoding: { format: "der", type: "pkcs8" },
    });

    return {
      id: key.publicKey.subarray(12).toString("base64"),
      outs: {
        publicKey: key.publicKey.subarray(12).toString("base64"),
        privateKey: key.privateKey.subarray(16).toString("base64"),
      },
    };
  }
}

export class KeyPair extends pulumi.dynamic.Resource {
  public readonly publicKey!: pulumi.Output<string>;
  public readonly privateKey!: pulumi.Output<string>;

  constructor(
    name: string,
    props: KeyPairInputs,
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(
      new KeyPairProvider(),
      name,
      {
        ...props,
        publicKey: undefined,
        privateKey: undefined,
      },
      opts,
    );
  }
}

export type IPv4Address = {
  address: string;
  netmask: string | number;
};

export type OtherPeer = {
  name?: string;
  address: pulumi.Input<IPv4Address>[];
  endpoint?: pulumi.Input<string>;
  keyPair: { publicKey: pulumi.Input<string> };
  allowedIPs?: pulumi.Input<IPv4Address>[] | undefined;
};

export type PeerArgs = {
  listenPort: pulumi.Input<number>;
  address: pulumi.Input<IPv4Address[]>;
  endpoint?: pulumi.Input<string>;
  connection: types.Connection;
  keyPair: pulumi.Input<KeyPair>;
  allowedIPs?: pulumi.Input<IPv4Address>[] | undefined;
  enableForwarding?: pulumi.Input<boolean>;
};

export class Peer extends pulumi.ComponentResource {
  listenPort: pulumi.Input<number>;
  address: pulumi.Input<IPv4Address[]>;
  endpoint: pulumi.Input<string> | undefined;
  connection: types.Connection;
  name: string;
  childInfo: pulumi.ComponentResourceOptions;
  keyPair: pulumi.Input<KeyPair>;
  allowedIPs: pulumi.Input<IPv4Address>[] | undefined;
  enableForwarding: pulumi.Input<boolean> | undefined;

  constructor(
    name: string,
    peerArgs: PeerArgs,
    opts: pulumi.ComponentResourceOptions = {},
  ) {
    super("wireguard:peer", name, {}, opts);

    this.name = name;

    this.address = peerArgs.address;
    this.listenPort = peerArgs.listenPort;
    this.endpoint = peerArgs.endpoint;
    this.connection = peerArgs.connection;
    this.childInfo = pulumi.mergeOptions(opts, { parent: this });
    this.keyPair = peerArgs.keyPair;
    this.allowedIPs = peerArgs.allowedIPs;
    this.enableForwarding = peerArgs.enableForwarding;
  }

  setupHost(peers: pulumi.Input<OtherPeer[]>) {
    return new command.remote.Command(
      `${this.name}-setup`,
      {
        connection: this.connection,
        addPreviousOutputInEnv: false,
        logging: "stdoutAndStderr",
        triggers: ["669"],
        create: pulumi.interpolate`sudo bash<<__EOF__
set -xeuo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -qy wireguard
cat<<EOF > /etc/wireguard/wg0.conf
${genConfig(this, peers)}
EOF
systemctl enable wg-quick@wg0
systemctl restart wg-quick@wg0
__EOF__
`,
      },
      this.childInfo,
    );
  }
}

export function genConfig(iface: Peer, peers?: pulumi.Input<OtherPeer[]>) {
  let output = pulumi.interpolate`[Interface]
Address = ${pulumi.output(iface.address).apply((a) => a.map((o) => `${o.address}/${o.netmask}`).join(", "))}
ListenPort = ${iface.listenPort}
PrivateKey = ${pulumi.output(iface.keyPair).privateKey}
`;

  if (iface.enableForwarding) {
    output = pulumi.concat(
      output,
      `PreUp = sysctl -w net.ipv4.ip_forward=1
`,
    );
  }

  if (peers === undefined) {
    return;
  }

  const sections = pulumi.output(peers).apply((peers) =>
    peers.map((p) => {
      let allowedIPs = pulumi
        .output(p.address)
        .apply((a) => a.map((o) => `${o.address}/32`).join(", "));

      if (p.allowedIPs !== undefined) {
        allowedIPs = pulumi.concat(
          allowedIPs,
          ",",
          pulumi
            .output(p.allowedIPs)
            .apply((a) => a.map((o) => `${o.address}/${o.netmask}`).join(", ")),
        );
      }

      let res = pulumi.interpolate`[Peer]
PublicKey = ${p.keyPair.publicKey}
AllowedIPs = ${allowedIPs}
`;
      if (p.endpoint) {
        res = pulumi.concat(
          res,
          pulumi.interpolate`Endpoint = ${p.endpoint}
`,
        );
      }

      return res;
    }),
  );

  output = pulumi.concat(
    output,
    pulumi.output(sections).apply((a) => a.join("\n")),
  );

  return output;
}
