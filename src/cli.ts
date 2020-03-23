// Build with
//  parcel watch --target node src/cli.ts

import { FormatPrettyPrint } from './ui/format-pprint';
import { IcoqPod } from './backend/core';



async function main() {

    var icoq = new IcoqPod();
    icoq.on('message', handleIncoming);

    await icoq.boot();

    icoq.command(['Init', {top_name: 'LF.Basics'}]);
    icoq.command(['Add', null, 2, 'Check 0.', true]);
    icoq.command(['Exec', 2]);

    return;
}
/*

    copy('examples/lf/Basics.v', '/lib/LF/Basics.v');
    copy('examples/lf/Induction.v', '/lib/LF/Induction.v');

    await core.run('/lib/icoq.bc', [], ['wacoq_post']);

    handleOutgoing(['Init', {top_name: 'LF.Basics'}]);
    handleOutgoing(['Load', '/lib/LF/Basics.v']);
    handleOutgoing(['Compile', '/lib/LF/Basics.vo']);

    fs.writeFileSync('examples/lf/Basics.vo', core.wasmFs.fs.readFileSync('/lib/LF/Basics.vo'));

    handleOutgoing(['Init', {top_name: 'LF.Induction'}]);
    handleOutgoing(['Load', '/lib/LF/Induction.v']);
    handleOutgoing(['Compile', '/lib/LF/Induction.vo']);

    fs.writeFileSync('examples/lf/Induction.vo', core.wasmFs.fs.readFileSync('/lib/LF/Induction.vo'));

    //console.log(core.wasmFs.fs.readFileSync('/home/Module.vo'));
}
*/

const pp = () => new FormatPrettyPrint();

function handleIncoming(msg: any[]) {
    if (msg[0] != 'Feedback') console.log(msg);
    if (msg[0] == 'Feedback' && msg[1].contents[0] == 'Message')
        console.log(pp().pp2Text(msg[1].contents[3]));
}



main();