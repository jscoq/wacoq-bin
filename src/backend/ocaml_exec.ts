import { ExecCore, ExecCoreOptions } from 'wasi-kernel/src/kernel/exec';


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
    callbacks: {[name: string]: i32}

    constructor(opts: OCamlExecutableOptions) {
        super(opts);
    }

    async run(bytecodeFile: string, args: string[], callbacks: string[] = []) {
        var bin = this.opts.binDir || '../bin';

        for (let p of this.preloads())
            await this.proc.dyld.preload(p.name, p.uri, p.reloc);

        await this.start(`${bin}/ocaml/ocamlrun.wasm`, ['ocamlrun', bytecodeFile, ...args]);

        this.api = <any>this.wasm.instance.exports as OCamlCAPI;
        this.callbacks = this._getCallbacks(callbacks);
    }

    preloads() {
        var bin = this.opts.binDir || '../bin';
        return ['dllcamlstr', 'dllunix', 'dllthreads', 'dllnums'].map(b => ({
            name: `${b}.so`, uri: `${bin}/ocaml/${b}.wasm`,
            reloc: {data: ['caml_atom_table'], func: [
                'caml_alloc', 'caml_alloc_small', 'caml_alloc_custom',
                'caml_copy_nativeint', 'caml_copy_string', 'caml_register_custom_operations',
                'memset', 'memmove', 'caml_hash_mix_uint32', 'caml_serialize_int_4',
                'caml_serialize_block_4', 'caml_deserialize_uint_4', 'caml_deserialize_block_4',
                'caml_invalid_argument', 'caml_named_value', 'caml_raise', 'snprintf'
            ]}
        })).concat(['dllbyterun_stubs'].map(b => ({
            name: `${b}.so`, uri: `${bin}/coq/${b}.wasm`,
            reloc: {data: ['caml_atom_table'], func: ['caml_copy_double']}
        })));        
    }

    to_caml_string(s: string) {
        var bytes = new TextEncoder().encode(s),
            a = this.api.caml_alloc_string(bytes.length);
        this.proc.membuf.set(bytes, a);
        return a;
    }

    _getCallbacks(names: string[]) {
        var callbacks: {[name: string]: i32} = {},
            x = this.api.malloc(Math.max(...names.map(s => s.length)) + 1);;
        for (let name of names) {
            this.proc.membuf.write(name + "\0", x);
            callbacks[name] = this.proc.mem.getUint32(this.api.caml_named_value(x), true);
        }
        this.api.free(x);
        return callbacks;     
    }

}



type OCamlExecutableOptions = ExecCoreOptions & {
    binDir?: string
};


export { OCamlExecutable, OCamlCAPI }
