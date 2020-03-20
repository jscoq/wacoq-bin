import * as fs from 'fs';

import { PackageManager, Resource } from 'basin-shell';
import { OCamlExecutable } from './backend/ocaml_exec';
import { FormatPrettyPrint } from './ui/format-pprint';



var core: OCamlExecutable, pm: PackageManager;


class FileResource extends Resource {
    blob() {
        return <any>fs.readFileSync(this.uri); // sorry
    }
}

async function main() {
    var binDir = 'bin';

    core = new OCamlExecutable({stdin: false, tty: false, binDir});
    core.debug = () => {};
    core.trace = () => {};

    var utf8 = new TextDecoder();

    core.on('stream:out', ev => console.log(utf8.decode(ev.data)));

    async function copy(fromPath, toPath) {
        var content = fs.readFileSync(fromPath);
        core.wasmFs.fs.writeFileSync(toPath, new Uint8Array(content));
    }

    pm = new PackageManager(core.wasmFs.volume);
    await pm.install({
        "/lib/": new FileResource(`${binDir}/coq/init.coq-pkg`),
    }, false);

    core.wasmFs.fs.mkdirpSync('/lib');
    await copy(`${binDir}/icoq.bc`, '/lib/icoq.bc');

    preloadStub(core);

    core.wasmFs.fs.mkdirpSync('/home');
    core.wasmFs.fs.writeFileSync('/home/Module.v', "Check 0.");

    await core.run('/lib/icoq.bc', [], ['wacoq_post']);

    handleOutgoing(['Init']);
    handleOutgoing(['Load', '/home/Module.v']);
    handleOutgoing(['Compile', '/home/Module.vo']);

    console.log(core.wasmFs.fs.readFileSync('/home/Module.vo'));
}


function handleOutgoing(cmd: any[]) {
    const callbacks = core.callbacks;

    if (!callbacks.wacoq_post) return;

    var json = (typeof cmd === 'string') ? cmd : JSON.stringify(cmd),
        answer = callbacks.wacoq_post(core.to_caml_string(json));
    _handleIncoming(answer);
}

function handleIncoming(msgs: any[][]) {
    for (let msg of msgs) {
        console.log(msg);
        if (msg[0] == 'Feedback' && msg[1].contents[0] == 'Message')
            console.log(new FormatPrettyPrint().pp2Text(msg[1].contents[3]));
    }
}

function _handleIncoming(ptr: number) {
    var cstr = core.proc.userGetCString(ptr);
    handleIncoming(JSON.parse(cstr.toString('utf-8')));
}


function preloadStub(core: OCamlExecutable) {
    core.proc.dyld.preload(
        'dllbyterun_stubs.so', `${core.opts.binDir}/coq/dllbyterun_stubs.wasm`,
        {
            data: ['caml_atom_table'], func: ['caml_copy_double'],
            js: {
                wacoq_emit_js: _handleIncoming
            }
        }
    );
}



main();