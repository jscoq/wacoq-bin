import { CoqDep } from './coqdep';



class Batch {

    worker: Worker

    constructor() {
        this.worker = new Worker(0 || './worker.js');  // bypass Parcel (fails to build worker at the moment)
    }

    expect(yes: (msg: any[]) => boolean, no: (msg: any[]) => boolean = Batch.isError) {
        const worker = this.worker;
        return new Promise((resolve, reject) => {
            function h(ev: any) {
                if (yes(ev.data))       { cleanup(); resolve(ev.data); }
                else if (no(ev.data))   { cleanup(); reject(ev.data); }
            }
            worker.addEventListener('message', h);
            function cleanup() { worker.removeEventListener('message', h); }
        });
    }    

    command(cmd: any[]) {
        this.worker.postMessage(cmd);
    }

    async do(...actions: (any[] | ((msg: any[]) => boolean))[]) {
        for (let action of actions)
            if (typeof action === 'function') await this.expect(action);
            else this.command(action);
    }

    static isError(msg: any[]) {
        return ['JsonExn', 'CoqExn'].includes(msg[0]);
    }

}


async function build(dir: string, logical: string | string[]) {
    var d = new CoqDep();
    d.searchPath.add(dir, logical);
    for (let m of d.searchPath.modules())
        d.processModule(m);

    var plan = d.buildOrder();

    var batch = new Batch();

    batch.worker.addEventListener('message', (ev) => {
        if (ev.data[0] != 'Feedback') console.log(ev.data);
    });


    await batch.do(
        msg => msg[0] == 'Boot',
        ['LoadPkg', '+coq-all'],
        msg => msg[0] === 'LibProgress' && msg[1].done
    );

    console.log('%c-- build worker started --', 'color: #f99');

    for (let m of plan.slice(0, 10)) {
        console.log(m);
        let vfilename = `/lib/${m.logical.join('/')}.v`,
            vofilename = `/lib/${m.logical.join('/')}.vo`;
        await batch.do(
            ['Init', {top_name: m.logical.join('.')}],
            ['Put', vfilename, d.fsif.fs.readFileSync(m.physical)],
            ['Load', vfilename],       msg => msg[0] == 'Loaded',
            ['Compile', vofilename],   msg => msg[0] == 'Compiled');
    }
}



export { Batch, build }
