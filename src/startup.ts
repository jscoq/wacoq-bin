// Build with
//  parcel watch --hmr-hostname=localhost --public-url '.' src/index.html src/worker.ts &

import { InteractiveConsole } from './ui/console';
import { CoqProject } from './build/project';
import { build } from './build/batch';



function main() {
    var startTime = +new Date(),
        elapsed = () => +new Date() - startTime;

    function milestone(caption) {
        console.log(`%c${caption} (+${elapsed()}ms)`, 'color: #99f');
    }

    var worker = new Worker(0 || './worker.js');  // bypass Parcel (fails to build worker at the moment)


    function sendCommand(cmd) {
        worker.postMessage(JSON.stringify(cmd));
    }

    var consl = new InteractiveConsole();

    worker.addEventListener('message', (ev) => {
        console.log(ev.data);

        switch (ev.data[0]) {
        case 'Starting':
            milestone('Starting');
            consl.showProgress('Starting', {done: false});  break;
        case 'Boot':
            milestone('Boot');
            sendCommand(['Init', {}]); break;
        case 'Ready':
            milestone('Ready');
            consl.showProgress('Starting', {done: true});
            sendCommand(['Add', null, null, 'Check nat.', true]);
            break;
        case 'Added':
            sendCommand(['Exec', ev.data[1]]);
            sendCommand(['Goals', ev.data[1]]); break;
        case 'Pending':
            let [, sid, prefix, modrefs] = ev.data;
            pi.loadModuleDeps(pi.findModules(prefix, modrefs)).then(() => {
                console.log('resolved');
                if (stms[sid])
                    sendCommand(['Add', null, sid, stms[sid], true]);
            });
            break;
        case 'GoalInfo':
            if (ev.data[2]) consl.writeGoals(ev.data[2]);  break;
        case 'CoqExn':
            if (ev.data[3]) consl.write(ev.data[3]);
            break;
        case 'Feedback':
            if (ev.data[1].contents[0] === 'Message')
                consl.write(ev.data[1].contents[3]);
            break;
        case 'LibProgress':
            var e = ev.data[1];
            if (e.uri) {
                var basename = e.uri.replace(/.*[/]/, ''),
                    msg = `Downloading ${basename}...`;
                consl.showProgress(e.uri, e, msg);
            }
            break;
        }
    });
    
    let sid = 4, stms = {};

    consl.on('data', (line) => {
        stms[++sid] = line;
        sendCommand(['Add', null, sid, line, false]);
    });

    consl.on('load-pkg', (ev) => worker.postMessage(['LoadPkg', ev.uri]));

    var pi = new PackageIndex(worker);
    pi.populate();

    Object.assign(window, {worker, pi});
}


// @todo move to backend/
class PackageIndex {

    pkgs: {[name: string]: any}
    directory: string[]
    loaded: string[]
    futures: {[name: string]: Future<any>}

    moduleIndex: Map<string, {name: string, deps: string[]}>

    worker: Worker

    constructor(worker: Worker) {
        this.pkgs = {};
        this.loaded = [];
        this.futures = {};
        this.moduleIndex = new Map();

        this.directory = ['init', 'coq-base', 'coq-collections', 'coq-arith', 'coq-reals'];

        this.worker = worker;
        if (worker)
            worker.addEventListener('message', ev => this.handleEvent(ev));
    }

    populate() {
        return Promise.all(this.directory.map(async pkg => {
            var manifest = await (await fetch(`../bin/coq/${pkg}.json`)).json();
            this.pkgs[pkg] = manifest;
            for (let mod of manifest.modules || [])
                this.moduleIndex.set(mod, manifest);
        }));
    }

    alldeps(mods: string[]) {
        return closure(new Set(mods),
            mod => (this.moduleIndex.get(mod).deps || {})[mod] || []);
    }

    async loadModuleDeps(mods: string[]) {
        var pdeps = new Set<string>();
        for (let m of this.alldeps(mods))
            pdeps.add(this.moduleIndex.get(m).name);
        // consistent order
        return this.loadPkgs(this.directory.filter(x => pdeps.has(x)));
    }

    loadPkgs(pkgs: string[]) {
        pkgs = pkgs.filter(pkg => !this.loaded.includes(pkg))

        var issue = [];
        var promises = pkgs.map(pkg => {
            if (!this.futures[pkg]) {
                this.futures[pkg] = new Future();
                issue.push(pkg);
            }
            return this.futures[pkg].promise;
        });
        this.worker.postMessage(['LoadPkg', issue.map(pkg => `+${pkg}`)]);
        return Promise.all(promises);
    }

    findModule(prefix: string, suffix: string) {
        prefix = prefix ? prefix + '.' : '';
        var dotsuffix = '.' + suffix;
        for (let k of this.moduleIndex.keys()) {
            if (k.startsWith(prefix) && (k == suffix || k.endsWith(dotsuffix)))
                return k;
        }
    }

    findModules(prefix: string, modrefs: string[]) {
        return modrefs.map(mr => this.findModule(prefix, mr)).filter(x => x);
    }

    handleEvent(ev: any) {
        if (ev.data[0] === 'LibProgress') {
            var e = ev.data[1];
            if (e.done) {
                var name = e.uri.replace(/^([+]|.*[/])/, '')
                                .replace(/[.][^.]*$/, '');
                this.loaded.push(name);
                if (this.futures[name]) this.futures[name].resolve();
            }
        }
    }

}


class Future<T> {
    promise: Promise<T>
    _resolve: (val: T) => void
    _reject: (err: any) => void
    _done: boolean
    _success: boolean

    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
        this._done = false;
        this._success = false;
    }

    resolve(val?: T)  { if (!this._done) { this._done = this._success = true; this._resolve(val); } }
    reject(err: any)  { if (!this._done) { this._done = true; this._reject(err); } }

    isDone()        { return this._done; }
    isSuccessful()  { return this._success; }
    isFailed()      { return this._done && !this._success; }
}


function closure<T>(s: Set<T>, tr: (t: T) => T[]) {
    var wl = [...s];
    while (wl.length > 0) {
        var u = wl.shift();
        for (let v of tr(u)) {
            if (!s.has(v)) {
                s.add(v);
                wl.push(v);
            }
        }
    }
    return s;
}



Object.assign(window, {main, CoqProject, build});
