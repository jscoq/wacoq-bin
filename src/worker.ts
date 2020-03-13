import { PackageManager, Resource } from 'basin-shell/src/package-mgr';

import { OCamlExecutable } from './ocaml_exec';



const devMode = true;


function postMessage(msg) {
    (<any>self).postMessage(msg);
}

async function main() {
    var core = new OCamlExecutable({stdin: false, tty: false})

    var utf8 = new TextDecoder();

    core.on('stream:out', ev => console.log(utf8.decode(ev.data)));

    async function copy(fromUri, toPath) {
        var content = await (await fetch(fromUri)).arrayBuffer();
        core.wasmFs.fs.writeFileSync(toPath, new Uint8Array(content));
    }

    var pm = new PackageManager(core.wasmFs.volume);
    pm.on('progress', ev => postMessage(['Progress', ev]));
    await pm.install({
        "/lib/": new Resource('/bin/coq/dist.zip')
    });

    if (devMode)
        await copy('/bin/icoq.bc', '/lib/icoq.bc');

    await core.run('/lib/icoq.bc');

    const api = core.api;

    const callbackNames = ['post'], callbacks: any = {},
          x = api.malloc(40);
    for (let nm of callbackNames) {
        core.proc.membuf.write(nm + "\0", x);
        callbacks[nm] = core.proc.mem.getUint32(api.caml_named_value(x), true);
    }
    api.free(x);

    addEventListener('message', (msg) => {
        console.log(msg);
        var answer = api.caml_callback(callbacks.post, core.to_caml_string(msg.data));
        for (let msg of JSON.parse(<any>core.proc.userGetCString(answer)))
            postMessage(msg);
    });

    postMessage(['Boot']);

    Object.assign(global, {core, api, callbacks, pm, Resource});
}


main();

Object.assign(global, {main});
