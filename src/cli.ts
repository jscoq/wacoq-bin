// Build with
//  parcel watch --target node src/cli.ts

import fs from 'fs';
import path from 'path';
import commander from 'commander';
import { FormatPrettyPrint } from './ui/format-pprint';
import { IcoqPod } from './backend/core';
import { CoqProject, SearchPathElement } from './build/project';
import { Workspace } from './build/workspace';



class CompileTask {

    icoq: IcoqPod
    outproj: CoqProject
    infiles: SearchPathElement[] = []
    outfiles: string[] = []

    opts: CompileTaskOptions

    constructor(icoq: IcoqPod, opts: CompileTaskOptions) {
        this.icoq = icoq;
        var outvol = {fs: <any>icoq.fs as typeof fs, path};
        this.outproj = new CoqProject('out', outvol);
        this.opts = opts;
    }

    async run(inproj: CoqProject, outname?: string) {
        this._listen();

        var plan = inproj.computeDeps().buildOrder();

        for (let mod of plan) {
            console.log(mod.physical);
            if (mod.physical.endsWith('.v'))
                this.compile(mod);
        }
    
        return (await this.toPackage(outname)).save();
    }

    compile(mod: SearchPathElement, opts=this.opts) {
        var {volume, logical, physical} = mod,
            infn = `/lib/${logical.join('/')}.v`, outfn = `${infn}o`;
        this.infiles.push(mod);
        this.icoq.command(['Put', infn, volume.fs.readFileSync(physical)]);

        if (opts.continue && this.outproj.volume.fs.existsSync(outfn)) {
            this.outfiles.push(outfn);
        }
        else {
            this.icoq.command(['Init', {top_name: logical.join('.')}]);
            this.icoq.command(['Load', infn]);
            this.icoq.command(['Compile', outfn]);
        }
    }

    toPackage(name?: string) {
        this.outproj.name = name;
        this.outproj.searchPath.addRecursive({physical: '/lib', logical: []});
        this.outproj.setModules(this._files());
        
        return this.outproj.toPackage(undefined, undefined,
            this.opts.jscoq ? CoqProject.backportToJsCoq : undefined);
    }

    _listen() {
        this.icoq.on('message', msg => this._handleMessage(msg));
    }

    _handleMessage(msg: any[]) {
        switch (msg[0]) {
        case 'Compiled':  this.outfiles.push(msg[1]); break;
        case 'CoqExn': throw new BuildError();
        }
    }

    _files(): (string | SearchPathElement)[] {
        return [].concat(this.infiles, this.outfiles);
    }

}

type CompileTaskOptions = {
    continue?: boolean
    jscoq?: boolean
};


class BuildError { }


class IcoqPodCLI extends IcoqPod {

    pp = new FormatPrettyPrint();

    constructor() {
        super();
        this.on('message', msg => this.handleIncoming(msg));
    }

    handleIncoming(msg: any[]) {
        switch (msg[0]) {
        case 'Feedback':
            switch (msg[1].contents[0]) {
            case 'Message':
                console.log(this.pp.pp2Text(msg[1].contents[3]));     break;
            }
            break;
        case 'CoqExn':
            if (msg[1])
                console.error(`\n${msg[1].fname[1]}:${msg[1].line_nb}:`);
            console.error(this.pp.pp2Text(msg[3]));                   break;
        default:
            console.log(msg);
        }
    }

}


class CLI {

    opts: any
    workspace: Workspace

    progress: (msg: string, done?: boolean) => void

    constructor(opts) {
        this.opts = opts;

        function progressTTY(msg: string, done: boolean = true) {
            process.stdout.write('\r' + msg + (done ? '\n' : ''));
        }
        function progressLog(msg: string, done: boolean = true) {
            if (done) console.log(msg);
        }
        this.progress = process.stdout.isTTY ? progressTTY : progressLog;
    }

    async prepare(opts = this.opts) {
        var workspace = new Workspace();
        if (opts.outdir)
            workspace.outDir = opts.outdir;
        if (!opts.nostdlib)
            opts.loads.push(...CLI.stdlibLoads());
        if (!opts.compile)
            await workspace.loadDeps(opts.loads);
        if (opts.workspace)
            workspace.open(opts.workspace);
        else if (opts.project)
            workspace.openProjectDirect(opts.package || path.basename(opts.project),
                                        opts.project, opts.top,
                                        opts.dirpaths.split(/[, ]/));
        else {
            console.error('what to build? specify either project or workspace.');
            throw new BuildError();
        }
        this.workspace = workspace;
    }

    async compile(opts = this.opts) {
        var outdir = this.workspace.outDir;

        // Fire up the pod
        var icoq = new IcoqPodCLI();
        await icoq.boot();
        await icoq.loadPackages(opts.loads);
    
        for (let [pkgname, inproj] of Object.entries(this.workspace.projs)) {
            var task = new CompileTask(icoq, <any>opts);

            var {pkg} = await task.run(inproj, 
                            opts.package || path.join(outdir, pkgname));
            this.progress(`wrote ${pkg.filename}.`, true);
        }
    }

    async package(opts = this.opts) {
        var outdir = this.workspace.outDir,
            f = opts.jscoq && CoqProject.backportToJsCoq;

        this.workspace.searchPath.createIndex();  // to speed up coqdep

        for (let pkgname in this.workspace.projs) {
            this.progress(`[${pkgname}] `, false);
            var p = await this.workspace.projs[pkgname]
                    .toPackage(opts.package || path.join(outdir, pkgname),
                               undefined, f);
            await p.save();    
            this.progress(`wrote ${p.pkg.filename}.`, true);
        }
    }

    static stdlib() {
        return require('./build/metadata/coq-pkgs.json');
    }

    static stdlibLoads() {
        return [...Object.keys(this.stdlib().projects)].map(pkg => `+${pkg}`);
    }

}



async function main() {

    var loads: string[] = [];

    var opts = commander
        .name('wacoq')
        .version('0.11.0', '-v, --version')
        .option('--workspace <w.json>',       'build projects from specified workspace')
        .option('--project <dir>',            'base directory for finding `.v` and `.vo` files')
        .option('--top <name>',               'logical name of toplevel directory')
        .option('--dirpaths <a.b.c>',         'logical paths containing modules (comma separated)', '')
        .option('--package <f.coq-pkg>',      'create a package (default extension is `.coq-pkg`)')
        .option('-d,--outdir <dir>',          'set default output directory')
        .option('--load <f.coq-pkg>',         'load package(s) for compilation and for module dependencies (comma separated, may repeat)')
        .option('--compile',                  'compile `.v` files to `.vo`')
        .option('--continue',                 'pick up from previous build')
        .option('--nostdlib',                 'skip loading the standard Coq packages')
        .option('--jscoq',                    'jsCoq compatibility mode')
        .on('option:load', pkg => loads.push(...pkg.split(',')))
        .parse(process.argv);

    if (opts.args.length > 0) {
        var a = !(opts.workspace || opts.project) && opts.args.shift();
        if (opts.args.length > 0) {
            console.error('extraneous arguments: ', opts.args);
            return 1;
        }
        if (a.endsWith('.json')) opts.workspace = a;
        else opts.project = a;
    }

    opts.loads = loads;

    var cli = new CLI(opts);

    try {
        await cli.prepare();
        if (opts.compile)
            await cli.compile();
        else
            await cli.package();
    }
    catch (e) {
        if (e instanceof BuildError) return 1;
        else throw e;
    }
}



main().then(rc => process.exit(rc || 0));