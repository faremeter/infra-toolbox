import type { Input, ComponentResource } from "@pulumi/pulumi";

export type Connection = {
  user: Input<string>;
  host: Input<string>;
  privateKey: Input<string>;
};

export interface Node extends ComponentResource {
  name: string;
  connection: Connection;
}

export function nameMaker(name: string) {
  return (...p: string[]) => [name, ...p].join("-");
}

export type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
