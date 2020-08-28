import assert from 'assert';
import type { ChildProcess, SpawnOptionsWithoutStdio } from 'child_process';
import { EventEmitter } from 'events';

const {spawn} = global.require('child_process') as 
                typeof import('child_process');



class SubprocessWorker extends EventEmitter {

    cp: ChildProcess
    
    constructor(command: string, args?: string[], options?: SpawnOptionsWithoutStdio) {
        super();
        this.cp = spawn(command, args, options);
        this.cp.stdout.on('data', buf => {
            for (let ln of buf.toString('utf-8').split('\n').filter(x => x)) {
                console.log('wacoq: ', ln);
                for (let msg of JSON.parse(ln))
                    this.emit('message', {data: msg});
            }
        });
        window.addEventListener('beforeunload', () => this.cp.stdin.end());
        setTimeout(() => this.emit('message', {data: ['Boot']}), 0);
    }

    addEventListener(event: "message", handler: (ev: {data: any[]}) => void) {
        this.on(event, handler);
    }

    postMessage(msg: string | {}) {
        if (typeof msg !== 'string') msg = JSON.stringify(msg);
        this.cp.stdin.write(msg + "\n");
    }
}


class IcoqSubprocess extends SubprocessWorker {

    binDir: string

    constructor() {
        var bin = IcoqSubprocess.findBinDir();
        super("ocamlrun", [bin + '/../icoq.bc', '-stdin'], {
            env: {
                PATH: process.env.PATH,
                CAML_LD_LIBRARY_PATH:
                    [bin, process.env.CAML_LD_LIBRARY_PATH].join(':')
            }
        });
        this.binDir = bin;
    }

    static findBinDir() {
        var bin = global.require('find-up')
                  .sync('bin/coq', {cwd: __dirname, type: 'directory'});
        assert(bin, 'bin/coq not found');
        return bin;
    }
}



export { IcoqSubprocess }
