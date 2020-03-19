import { PackageManager, Resource } from 'basin-shell/src/package-mgr';

import { OCamlExecutable } from './backend/ocaml_exec';



var core: OCamlExecutable, pm: PackageManager,
    handleCommand: (msg: string | any[]) => void;

function postMessage(msg) {
    (<any>self).postMessage(msg);
}

function postMessagesFromJson(json: string | Uint8Array) {
    for (let msg of JSON.parse(<any>json))
        postMessage(msg);
}

async function main() {
    var binDir = process.env.NODE_NOW ? './bin' : '../bin';

    core = new OCamlExecutable({stdin: false, tty: false, binDir});
    core.debug = () => {};
    core.trace = () => {};

    var utf8 = new TextDecoder();

    core.on('stream:out', ev => console.log(utf8.decode(ev.data)));

    async function copy(fromUri, toPath) {
        var content = await (await fetch(fromUri)).arrayBuffer();
        core.wasmFs.fs.writeFileSync(toPath, new Uint8Array(content));
    }

    postMessage(['Starting']);

    core.wasmFs.fs.mkdirpSync('/lib');
    await copy(`${binDir}/icoq.bc`, '/lib/icoq.bc');

    preloadStub(core);

    await core.run('/lib/icoq.bc', [], ['wacoq_post']);


    pm = new PackageManager(core.wasmFs.volume);
    pm.on('progress', ev => postMessage(['LibProgress', ev]));
    await pm.install({
        "/lib/": new Resource(`${binDir}/coq/init.coq-pkg`)
    });


    const api = core.api, callbacks = core.callbacks;


    handleCommand = (cmd) => {
        if (cmd[0] === 'LoadPkg') { loadPackage(cmd[1]); return; }

        if (!callbacks.wacoq_post) return;

        var json = (typeof cmd === 'string') ? cmd : JSON.stringify(cmd),
            answer = callbacks.wacoq_post(core.to_caml_string(json));
        postMessagesFromJson(<any>core.proc.userGetCString(answer));
    };

    addEventListener('message', (msg) => {
        console.log(msg.data);
        handleCommand(msg.data);
    });

    postMessage(['Boot']);

    Object.assign(global, {core, api, callbacks, pm, Resource, handleCommand});
}


function preloadStub(core: OCamlExecutable) {
    core.proc.dyld.preload(
        'dllbyterun_stubs.so', `${core.opts.binDir}/coq/dllbyterun_stubs.wasm`,
        {
            data: ['caml_atom_table'], func: ['caml_copy_double'],
            js: {
                wacoq_emit_js: (s:number) =>
                    postMessagesFromJson(core.proc.userGetCString(s))
            }
        }
    );
}

async function loadPackage(uri) {
    await pm.install({
        "/lib/": new Resource(uri)
    });
    handleCommand(['RefreshLoadPath']);
}


main();

Object.assign(global, {main});
