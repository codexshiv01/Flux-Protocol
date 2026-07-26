import type {
  Directive,
  DirectiveArg,
  FieldDef,
  FluxSchema,
  RpcDef,
  ServiceDef,
  TypeDef,
} from "./ast.js";

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): FluxSchema {
    this.skip();
    let pkg = "";
    const types: TypeDef[] = [];
    const services: ServiceDef[] = [];

    while (!this.eof()) {
      this.skip();
      if (this.eof()) break;
      if (this.matchKeyword("package")) {
        pkg = this.expectDottedIdent();
        this.expect(";");
        continue;
      }
      if (this.peekKeyword("input")) {
        this.matchKeyword("input");
        types.push(this.parseType("input"));
        continue;
      }
      if (this.matchKeyword("type")) {
        types.push(this.parseType("type"));
        continue;
      }
      if (this.matchKeyword("service")) {
        services.push(this.parseService());
        continue;
      }
      throw this.error(`Unexpected token near: ${this.src.slice(this.i, this.i + 20)}`);
    }

    return { package: pkg, types, services };
  }

  private parseType(kind: "type" | "input"): TypeDef {
    const name = this.expectIdent();
    this.expect("{");
    const fields: FieldDef[] = [];
    while (!this.match("}")) {
      fields.push(this.parseField());
    }
    return { kind, name, fields };
  }

  private parseField(): FieldDef {
    const name = this.expectIdent();
    this.expect(":");
    let isList = false;
    let listNonNull = false;
    let typeName: string;
    if (this.match("[")) {
      isList = true;
      typeName = this.expectIdent();
      listNonNull = this.match("!");
      this.expect("]");
    } else {
      typeName = this.expectIdent();
    }
    const nonNull = this.match("!");
    const directives = this.parseDirectives();
    return { name, typeName, isList, listNonNull, nonNull, directives };
  }

  private parseService(): ServiceDef {
    const name = this.expectIdent();
    this.expect("{");
    const rpcs: RpcDef[] = [];
    while (!this.match("}")) {
      rpcs.push(this.parseRpc());
    }
    return { name, rpcs };
  }

  private parseRpc(): RpcDef {
    this.expectKeyword("rpc");
    const name = this.expectIdent();
    this.expect("(");
    const input = this.expectIdent();
    this.expect(")");
    this.expect("->");
    const streaming = this.matchKeyword("stream");
    const output = this.expectIdent();
    const directives = this.parseDirectives();
    return { name, input, output, streaming, directives };
  }

  private parseDirectives(): Directive[] {
    const dirs: Directive[] = [];
    while (this.match("@")) {
      const name = this.expectIdent();
      const args: Record<string, DirectiveArg> = {};
      if (this.match("(")) {
        if (!this.match(")")) {
          do {
            // support @cost(10) and @cache(maxAge: 60)
            const peek = this.peekIdent();
            if (peek && this.lookaheadIsArgName()) {
              const key = this.expectIdent();
              this.expect(":");
              args[key] = this.parseArgValue();
            } else {
              args.value = this.parseArgValue();
            }
          } while (this.match(","));
          this.expect(")");
        }
      }
      dirs.push({ name, args });
    }
    return dirs;
  }

  private lookaheadIsArgName(): boolean {
    const save = this.i;
    try {
      this.skip();
      if (!/[A-Za-z_]/.test(this.src[this.i] ?? "")) return false;
      while (/[A-Za-z0-9_]/.test(this.src[this.i] ?? "")) this.i++;
      this.skip();
      return this.src[this.i] === ":";
    } finally {
      this.i = save;
    }
  }

  private parseArgValue(): DirectiveArg {
    this.skip();
    if (this.src[this.i] === '"') {
      this.i++;
      let s = "";
      while (!this.eof() && this.src[this.i] !== '"') {
        s += this.src[this.i++];
      }
      this.expect('"');
      return s;
    }
    if (/[0-9-]/.test(this.src[this.i] ?? "")) {
      let n = "";
      if (this.src[this.i] === "-") n += this.src[this.i++];
      while (/[0-9.]/.test(this.src[this.i] ?? "")) n += this.src[this.i++];
      return Number(n);
    }
    if (this.matchKeyword("true")) return true;
    if (this.matchKeyword("false")) return false;
    return this.expectIdent();
  }

  private eof() {
    return this.i >= this.src.length;
  }

  private skip() {
    while (!this.eof()) {
      const c = this.src[this.i];
      if (c === " " || c === "\n" || c === "\r" || c === "\t") {
        this.i++;
        continue;
      }
      if (c === "/" && this.src[this.i + 1] === "/") {
        while (!this.eof() && this.src[this.i] !== "\n") this.i++;
        continue;
      }
      break;
    }
  }

  private match(ch: string): boolean {
    this.skip();
    if (this.src.startsWith(ch, this.i)) {
      this.i += ch.length;
      return true;
    }
    return false;
  }

  private expect(ch: string) {
    if (!this.match(ch)) throw this.error(`Expected '${ch}'`);
  }

  private peekKeyword(kw: string): boolean {
    this.skip();
    return (
      this.src.startsWith(kw, this.i) &&
      !/[A-Za-z0-9_]/.test(this.src[this.i + kw.length] ?? "")
    );
  }

  private matchKeyword(kw: string): boolean {
    if (!this.peekKeyword(kw)) return false;
    this.i += kw.length;
    return true;
  }

  private expectKeyword(kw: string) {
    if (!this.matchKeyword(kw)) throw this.error(`Expected keyword ${kw}`);
  }

  private peekIdent(): string | null {
    this.skip();
    if (!/[A-Za-z_]/.test(this.src[this.i] ?? "")) return null;
    let j = this.i;
    while (/[A-Za-z0-9_]/.test(this.src[j] ?? "")) j++;
    return this.src.slice(this.i, j);
  }

  private expectIdent(): string {
    const id = this.peekIdent();
    if (!id) throw this.error("Expected identifier");
    this.i += id.length;
    return id;
  }

  private expectDottedIdent(): string {
    let name = this.expectIdent();
    while (this.match(".")) {
      name += "." + this.expectIdent();
    }
    return name;
  }

  private error(msg: string): Error {
    const line = this.src.slice(0, this.i).split("\n").length;
    return new Error(`${msg} (line ${line})`);
  }
}

export function parseFlux(source: string): FluxSchema {
  return new Parser(source).parse();
}
