import { ExecCore, ExecCoreOptions } from 'wasi-kernel';



interface OCamlCAPI {
    malloc(sz: i32): i32;
    free(p: i32): void;
    caml_alloc_string(len: i32): i32;
    caml_named_value(name: i32): i32;
    caml_callback(closure: i32, arg: i32): i32;
}

type i32 = number;


class OCamlExecutable extends ExecCore {

    opts: OCamlExecutableOptions
    api: OCamlCAPI
    callbacks: {[name: string]: (arg: i32) => i32}

    constructor(opts: OCamlExecutableOptions) {
        super(opts);
    }

    async run(bytecodeFile: string, args: string[], callbacks: string[] = []) {
        var bin = this.opts.binDir || '../bin';

        for (let p of this.preloads())
            await this.proc.dyld.preload(p.name, p.uri);

        await this.start(`${bin}/ocaml/ocamlrun.wasm`, ['ocamlrun', bytecodeFile, ...args]);

        this.api = <any>this.wasm.instance.exports as OCamlCAPI;
        this.callbacks = this._getCallbacks(callbacks);
    }

    preloads() {
        var bin = this.opts.binDir || '../bin';
        return ['dllcamlstr', 'dllunix', 'dllthreads'].map(b => ({
            name: `${b}.so`, uri: `${bin}/ocaml/${b}.wasm`
        })).concat({name: 'dllnums.so', uri: `${bin}/num/dllnums.wasm`});
    }

    to_caml_string(s: string) {
        var bytes = new TextEncoder().encode(s),
            a = this.api.caml_alloc_string(bytes.length);
        this.proc.membuf.set(bytes, a);
        return a;
    }

    _getCallbacks(names: string[]) {
        var callbacks: {[name: string]: (arg: i32) => i32} = {},
            x = this.api.malloc(Math.max(...names.map(s => s.length)) + 1);;
        for (let name of names) {
            this.proc.membuf.write(name + "\0", x);
            let closure_f = this.api.caml_named_value(x);
            if (closure_f) {
                callbacks[name] = (arg: i32) =>
                    this.api.caml_callback(this.proc.mem.getUint32(closure_f, true), arg);
            }
        }
        this.api.free(x);
        return callbacks;     
    }

}



type OCamlExecutableOptions = ExecCoreOptions & {
    binDir?: string
};


export { OCamlExecutable, OCamlCAPI }
