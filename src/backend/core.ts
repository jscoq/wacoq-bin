import { EventEmitter } from 'events';
import JSZip from 'jszip';
import { DEFLATE } from 'jszip/lib/compressions'
import { inflateRaw } from 'pako';

import { OCamlExecutable } from './ocaml_exec';



class IcoqPod extends EventEmitter {

    core: OCamlExecutable

    binDir: string
    io: IO

    constructor(binDir?: string) {
        super();
        binDir = binDir || (typeof fetch === 'undefined'
                            || process.env.NODE_NOW ? './bin' : '../bin');
        this.binDir = binDir;

        this.core = new OCamlExecutable({stdin: false, tty: false, binDir});
        this.core.debug = () => {};
        this.core.trace = () => {};        

        var utf8 = new TextDecoder();
        this.core.on('stream:out', ev => console.log(utf8.decode(ev.data)));

        this.io = new IO;
    }

    get fs() { return this.core.fs; }

    async boot() {
        await this.upload(`${this.binDir}/icoq.bc`, '/lib/icoq.bc');
    
        this._preloadStub();
    
        await this.core.run('/lib/icoq.bc', [], ['wacoq_post']);
    
        await this.loadPackage('+init', false);    
    }

    async upload(fromUri: string, toPath: string) {
        var content = await this.io._fetch(fromUri);
        this.putFile(toPath, content);
    }

    loadPackage(uri: string, refresh: boolean = true) {
        return this.loadPackages([uri], refresh);
    }

    async loadPackages(uris: string | string[], refresh: boolean = true) {
        if (typeof uris == 'string') uris = [uris];
        
        await Promise.all(uris.map(async uri => {
            await this.unzip(uri, '/lib');
            this._progress(uri, undefined, true);
        }));

        if (refresh)
            this.command(['RefreshLoadPath']);

        this.answer([['LoadedPkg', uris]]);
    }

    async loadSources(uri: string, dirpath: string) {
        var subdir = dirpath.replace(/[.]|([^/])$/g, '$1/');
        this.unzip(uri, `/src/${subdir}`);
    }

    unzip(uri: string, dir: string) {
        return this.io.unzip(this._pkgUri(uri),
                    (fn, ui8a) => this.putFile(`${dir}/${fn}`, ui8a),
                    p => this._progress(uri, p));
    }

    _pkgUri(uri: string) {
        return (uri[0] == '+') ?
            `${this.binDir}/coq/${uri.substring(1)}.coq-pkg` : uri;
    }

    _progress(uri: string, download: DownloadProgress, done = false) {
        this.emit('progress', {uri, download, done});
    }

    putFile(filename: string, content: Uint8Array | string) {
        if (!filename.startsWith('/')) filename = `/lib/${filename}`;
        // needs to be synchronous
        this.fs.mkdirpSync(filename.replace(/[/][^/]+$/, ''))
        this.fs.writeFileSync(filename, content);
    }

    getFile(filename: string) {
        if (!filename.startsWith('/')) filename = `/lib/${filename}`;
        var buf: Uint8Array = null;
        try { buf = <any>this.fs.readFileSync(filename); } catch { }
        this.answer([['Got', filename, buf]]);
    }

    command(cmd: any[]) {
        switch (cmd[0]) {
        case 'LoadPkg':   this.loadPackages(cmd[1]);               return;
        case 'Put':       this.putFile(cmd[1], cmd[2]);            return;
        case 'Get':       this.getFile(cmd[1]);                    return;
        }

        const wacoq_post = this.core.callbacks && this.core.callbacks.wacoq_post;
        if (!wacoq_post) return;

        var json = (typeof cmd === 'string') ? cmd : JSON.stringify(cmd),
            answer = wacoq_post(this.core.to_caml_string(json));
        this._answer(answer);
    }
    
    answer(msgs: any[][]) {
        for (let msg of msgs) this.emit('message', msg);
    }
    
    _answer(ptr: number) {
        var cstr = this.core.proc.userGetCString(ptr);
        this.answer(JSON.parse(<any>cstr));
    }

    /**
     * (internal) Initializes the dllbyterun_stub shared library.
     */
    _preloadStub() {
        this.core.proc.dyld.preload(
            'dllbyterun_stubs.so', `${this.binDir}/coq/dllbyterun_stubs.wasm`,
            {
                data: ['caml_atom_table'], func: ['caml_copy_double'],
                js: {
                    wacoq_emit_js: (s:number) => this._answer(s)
                }
            }
        );
    }    
}


class IO {

    async unzip(zip: string | JSZip, put: (filename: string, content: Uint8Array) => void, progress?: (p: any) => void) {
        if (typeof zip == 'string')
            zip = await JSZip.loadAsync(await this._fetch(zip, progress));

        let yc = 0;
        for (let entry of zip.filter((_, e) => !e.dir)) {
            put(entry.name, this._inflateFast(entry));
            if (!((++yc) & 0xf)) await _yield();
        }
    }

    _inflateFast(entry: any) {
        if (entry._data.compression == DEFLATE)
            return inflateRaw(entry._data.compressedContent);
        else /* STORE */
            return entry._data.compressedContent;
    }

    async _fetch(uri: string, progress?: (p: any) => void) : Promise<Uint8Array> {
        if (progress && typeof fetch !== 'undefined') {
            return this._toU8A(this._fetchWithProgress(uri, progress));
        }
        else return this._fetchSimple(uri);
    }

    async _toU8A(blob: Promise<Blob>) {
        return new Uint8Array(await (await blob).arrayBuffer());
    }

    async _fetchSimple(uri: string) {
        if (typeof fetch !== 'undefined') {
            return new Uint8Array(await (await fetch(uri)).arrayBuffer())
        }
        else {
            const fs = require('fs');
            return (0||fs.readFileSync)(uri);
        }
    }

    // boilerplate
    async _fetchWithProgress(uri: string, progress: (p: any) => void) {
        var response = await fetch(uri),
            total = +response.headers.get('Content-Length'),
            r = response.body.getReader(), chunks = [], downloaded = 0;
        for(;;) {
            var {value, done} = await r.read();
            if (done) break;
            chunks.push(value);
            downloaded += value.length;
            progress({total, downloaded})
        }
        return new Blob(chunks);
    }

}

function _yield() { return new Promise(resolve => setTimeout(resolve, 0)); }


type DownloadProgress = { total: number, downloaded: number };



export  { IcoqPod, DownloadProgress }
