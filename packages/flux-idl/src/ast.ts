export type DirectiveArg = string | number | boolean;

export interface Directive {
  name: string;
  args: Record<string, DirectiveArg>;
}

export interface FieldDef {
  name: string;
  typeName: string;
  isList: boolean;
  listNonNull: boolean;
  nonNull: boolean;
  directives: Directive[];
}

export interface TypeDef {
  kind: "type" | "input";
  name: string;
  fields: FieldDef[];
}

export interface RpcDef {
  name: string;
  input: string;
  output: string;
  streaming: boolean;
  directives: Directive[];
}

export interface ServiceDef {
  name: string;
  rpcs: RpcDef[];
}

export interface FluxSchema {
  package: string;
  types: TypeDef[];
  services: ServiceDef[];
}

export type SelectionSet = { [field: string]: true | SelectionSet };
