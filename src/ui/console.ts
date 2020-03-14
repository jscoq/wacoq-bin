import { EventEmitter } from 'events';
import $ from 'jquery';

import { FormatPrettyPrint } from './format-pprint';


class InteractiveConsole extends EventEmitter {

    console: JQuery
    prompt: JQuery
    progress: {[desc: string]: JQuery}

    pprint: FormatPrettyPrint

    constructor() {
        super();
        this.console = $('#console');
        this.prompt = $('#prompt');
        this.progress = {};

        this.pprint = new FormatPrettyPrint();

        this.prompt.keydown((ev) => {
            if (ev.key === 'Enter') {
                this.emit('data', this.prompt.val());
                this.prompt.val('');
            }
        });
    }

    write(msg : string | any[]) {
        var p = $('<div>');
        if (typeof msg === 'string')
            p.text(msg);
        else 
            p.append(...this.pprint.pp2DOM(msg));
        p.insertBefore(this.prompt);
        return p;
    }    

    showProgress(desc: string, done: boolean, msg?: string) {
        if (done) {
            var p = this.progress[desc];
            if (p) {
                p.remove(); delete this.progress[desc];
            }
        }
        else {
            this.progress[desc] = this.write(msg || `${desc}...`);
        }
    }

}


export { InteractiveConsole }
