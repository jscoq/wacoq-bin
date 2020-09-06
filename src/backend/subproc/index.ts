/**
 * Allows running `icoq` as a native subprocess instead of a WebAssembly
 * instance. Requires a Node.js environment.
 * Communication between the main process and `icoq` is through stdio.
 * Each line is a JSON document containing a command (stdin) or list of
 * answers (stdout).
 */
import assert from 'assert';
import fs from 'fs';
import mkdirp from 'mkdirp';
import { ChildProcess, SpawnOptionsWithoutStdio, spawn } from 'child_process';
import { EventEmitter } from 'events';
import byline from 'byline';
import { PackageDirectory } from './packages';



class SubprocessWorker extends EventEmitter {

    cp: ChildProcess
    
    constructor(command: string, args?: string[], options?: SpawnOptionsWithoutStdio) {
        super();
        this.cp = spawn(command, args, options);
        byline(this.cp.stdout).on('data', ln => {
            try {
                for (let msg of JSON.parse(ln))
                    this.emit('message', {data: msg});
            }
            catch (e) { console.error("(from subprocess)", e, ln.toString('utf-8')); }
        });
        window.addEventListener('beforeunload', () => this.cp.stdin.end());
        setTimeout(() => this.emit('message', {data: ['Boot']}), 0);
    }

    addEventListener(event: "message", handler: (ev: {data: any[]}) => void) {
        this.on(event, handler);
    }

    removeEventListener(event: "message", handler: (ev: {data: any[]}) => void) {
        this.off(event, handler);
    }

    postMessage(msg: string | [string, ...any[]]) {
        switch (msg[0]) {
        case 'Put': this.putFile(msg[1], msg[2]); return;
        }
        if (typeof msg !== 'string') msg = JSON.stringify(msg);
        this.cp.stdin.write(msg + "\n");
    }

    putFile(filename: string, content: any) {
        mkdirp.sync(filename.replace(/[/][^/]+$/, ''))
        fs.writeFileSync(filename, content);
    }
}


class IcoqSubprocess extends SubprocessWorker {

    binDir: string
    packages: PackageDirectory

    constructor() {
        var bin = IcoqSubprocess.findBinDir();
        super("ocamlrun", [bin + '/../icoq.bc', '-stdin'], {
            env: {
                PATH: process.env.PATH,
                CAML_LD_LIBRARY_PATH:
                    [bin, process.env.CAML_LD_LIBRARY_PATH || ''].join(':')
            }
        });
        this.binDir = bin;
        this.packages = new PackageDirectory('/tmp/lib');
    }

    postMessage(msg: string | [string, ...any[]]) {
        switch (msg[0]) {
        case 'LoadPkg': this.loadPackages(msg[1]); return;
        }
        super.postMessage(msg);
    }

    async loadPackages(uris: string | string[]) {
        uris = await this.packages.loadPackages(uris);
        for (let uri of uris)
            this.emit('message', {data: ['LibProgress', {uri, done: true}]});
        this.emit('message', {data: ['LoadedPkg', uris]});
    }

    static findBinDir() {
        var bin = global.require('find-up')
                  .sync('bin/coq', {cwd: __dirname, type: 'directory'});
        assert(bin, 'bin/coq not found');
        return bin;
    }
}



export { IcoqSubprocess }
