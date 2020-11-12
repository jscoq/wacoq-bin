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
        setTimeout(() => this.emit('message', {data: ['Boot']}), 0);
    }

    end() {
        this.cp.stdin.end();
    }

    terminate() {
        this.cp.kill("SIGINT");
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

    constructor(options: IcoqSubprocessOptions = {}) {
        options = {...IcoqSubprocess.DEFAULT_OPTIONS, ...options};

        var bin = IcoqSubprocess.findBinDir(),
            [prog, args] = IcoqSubprocess.findExecutable(bin, options.mode);

        super(prog, [...args, '-stdin'], {
            cwd: options.cwd,
            env: {
                PATH: process.env.PATH,
                CAML_LD_LIBRARY_PATH:
                    [bin, process.env.CAML_LD_LIBRARY_PATH || ''].join(':')
            }
        });
        this.binDir = bin;
        this.packages = new PackageDirectory('/tmp/lib');
        this.packages.on('message', ev => this.emit('message', ev));
    }

    postMessage(msg: string | [string, ...any[]]) {
        switch (msg[0]) {
        case 'LoadPkg': this.packages.loadPackages(msg[1]); return;
        }
        super.postMessage(msg);
    }

    static findBinDir() {
        var bin = global.require('find-up')
                  .sync('bin/coq', {cwd: __dirname, type: 'directory'});
        assert(bin, 'bin/coq not found');
        return bin;
    }

    static findExecutable(binDir: string,
                          mode: IcoqSubprocessMode) : [string, string[]] {
        var byte = `${binDir}/../icoq.bc`,
            exe = `${binDir}/../icoq.exe`;
        switch (mode) {
        case "byte":   return ["ocamlrun", [byte]];
        case "native": return [exe, []];
        case "best":
            return fs.existsSync(exe) ? [exe, []] : ["ocamlrun", [byte]];
        default:
            assert(false, `invalid mode '${mode}'`);
        }
    }

    static DEFAULT_OPTIONS: IcoqSubprocessOptions = {mode: "best", cwd: "/tmp"};
}

type IcoqSubprocessMode = "byte" | "native" | "best";
type IcoqSubprocessOptions = {mode?: IcoqSubprocessMode, cwd?: string};


export { IcoqSubprocess }
