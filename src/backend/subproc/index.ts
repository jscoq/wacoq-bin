/**
 * Allows running `icoq` as a native subprocess instead of a WebAssembly
 * instance. Requires a Node.js environment.
 * Communication between the main process and `icoq` is through stdio.
 * Each line is a JSON document containing a command (stdin) or list of
 * answers (stdout).
 */
import assert from 'assert';
import fs from 'fs';
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
            catch (e) { console.error("(from subprocess)", ln.toString('utf-8'), e); }
        });
        setTimeout(() => this.emit('message', {data: ['Boot']}), 0);
        // forward child process events
        this.cp.on('error', e => this.emit('error', e));
        this.cp.on('exit', (code, signal) => this.emit('exit', code, signal));
    }

    end() {
        this.cp.stdin.end();
    }

    terminate() {
        this.cp.kill("SIGINT");
    }

    addEventListener(event: string, handler: (...a: any[]) => void) {
        this.on(event, handler);
    }

    removeEventListener(event: string, handler: (...a: any[]) => void) {
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
        fs.mkdirSync(filename.replace(/[/][^/]+$/, ''), {recursive: true});
        fs.writeFileSync(filename, content);
    }
}

interface SubprocessWorker {
    addEventListener(event: "message", handler: (ev: {data: any[]}) => void): void;
    addEventListener(event: "error", handler: (e: Error) => void): void;
    addEventListener(event: "exit", handler: (code: number, signal: NodeJS.Signals) => void): void;
    removeEventListener(event: "message", handler: (ev: {data: any[]}) => void): void;
    removeEventListener(event: "error", handler: (e: Error) => void): void;
    removeEventListener(event: "exit", handler: (code: number, signal: NodeJS.Signals) => void): void;    
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
        this.packages = new PackageDirectory('/tmp/wacoq/lib');
        this.packages.on('message', ev => this.emit('message', ev));
        this.packages.appropriatePlugins(this.binDir);
    }

    postMessage(msg: string | [string, ...any[]]) {
        switch (msg[0]) {
        case 'LoadPkg': this.packages.loadPackages(msg[1]); return;
        }
        super.postMessage(msg);
    }

    static findBinDir() {
        var cwd = typeof __dirname !== 'undefined' && __dirname !== '/' ? __dirname : '.';
        var bin = global.require('find-up')
                  .sync('bin/coq', {cwd, type: 'directory'});
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

    static DEFAULT_OPTIONS: IcoqSubprocessOptions = {mode: "best", cwd: "/tmp/wacoq"};
}

type IcoqSubprocessMode = "byte" | "native" | "best";
type IcoqSubprocessOptions = {mode?: IcoqSubprocessMode, cwd?: string};


export { IcoqSubprocess }
