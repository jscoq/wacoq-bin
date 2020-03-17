import { PackageManager, Resource } from 'basin-shell/src/package-mgr';

import { OCamlExecutable } from './ocaml_exec';



var core: OCamlExecutable, pm: PackageManager,
    handleCommand: (msg: string | any[]) => void;

function postMessage(msg) {
    (<any>self).postMessage(msg);
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

    pm = new PackageManager(core.wasmFs.volume);
    pm.on('progress', ev => postMessage(['Progress', ev]));
    await pm.install({
        "/lib/": new Resource(`${binDir}/coq/dist-init.zip`)
    });

    if (process.env.NODE_ENV === 'development')  // Parcel sets this
        await copy(`${binDir}/icoq.bc`, '/lib/icoq.bc');

    postMessage(['Starting']);

    await core.run('/lib/icoq.bc');

    const api = core.api;

    const callbackNames = ['post'], callbacks: any = {},
          x = api.malloc(40);
    for (let nm of callbackNames) {
        core.proc.membuf.write(nm + "\0", x);
        callbacks[nm] = core.proc.mem.getUint32(api.caml_named_value(x), true);
    }
    api.free(x);

    handleCommand = (cmd) => {
        if (cmd[0] === 'LoadPkg') { loadPackage(cmd[1]); return; }

        if (!callbacks.post) return;

        var json = (typeof cmd === 'string') ? cmd : JSON.stringify(cmd),
            answer = api.caml_callback(callbacks.post, core.to_caml_string(json));
        for (let msg of JSON.parse(<any>core.proc.userGetCString(answer)))
            postMessage(msg);
    };

    addEventListener('message', (msg) => {
        console.log(msg.data);
        handleCommand(msg.data);
    });

    postMessage(['Boot']);

    Object.assign(global, {core, api, callbacks, pm, Resource});
}


async function loadPackage(uri) {
    await pm.install({
        "/lib/": new Resource(uri)
    });
    handleCommand(['RefreshLoadPath']);
}


main();

Object.assign(global, {main});
