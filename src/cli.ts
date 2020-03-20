// Build with
//  parcel watch --target node src/cli.ts

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
        "/lib/": new FileResource(`${binDir}/coq/coq-all.coq-pkg`),
    }, false);

    core.wasmFs.fs.mkdirpSync('/lib');
    await copy(`${binDir}/icoq.bc`, '/lib/icoq.bc');

    preloadStub(core);

    core.wasmFs.fs.mkdirpSync('/lib/LF');
    copy('examples/lf/Basics.v', '/lib/LF/Basics.v');
    copy('examples/lf/Induction.v', '/lib/LF/Induction.v');

    await core.run('/lib/icoq.bc', [], ['wacoq_post']);

    handleOutgoing(['Init', {top_name: 'LF.Basics'}]);
    handleOutgoing(['Load', '/lib/LF/Basics.v']);
    handleOutgoing(['Compile', '/lib/LF/Basics.vo']);

    fs.writeFileSync('examples/lf/Basics.vo', core.wasmFs.fs.readFileSync('/lib/LF/Basics.vo'));

    handleOutgoing(['Init', {top_name: 'LF.Induction'}]);
    handleOutgoing(['Load', '/lib/LF/Induction.v']);
    handleOutgoing(['Compile', '/lib/LF/Induction.vo']);

    fs.writeFileSync('examples/lf/Induction.vo', core.wasmFs.fs.readFileSync('/lib/LF/Induction.vo'));

    //console.log(core.wasmFs.fs.readFileSync('/home/Module.vo'));
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
        if (msg[0] != 'Feedback') console.log(msg);
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