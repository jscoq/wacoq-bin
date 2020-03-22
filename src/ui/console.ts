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

        this.console.find('.side-note a').click((ev) => {
            ev.preventDefault();
            var side = $(ev.target).closest('.side-note');
            $(ev.target).remove();
            if (side.find('a').length == 0) side.remove();
            this.emit('load-pkg', {uri: $(ev.target).attr('href')});
        });
    }

    write(msg : string | any[]) {
        var p = $('<div>');
        if (typeof msg === 'string')
            p.addClass('plain').text(msg);
        else 
            p.addClass('pp').append(...this.pprint.pp2DOM(msg));
        p.insertBefore(this.prompt);
        return p;
    }

    writeGoals(goals: any[]) {
        var p = $('<div>');
        p.append(this.pprint.goals2DOM(goals));
        p.insertBefore(this.prompt);
        return p;
    }

    showProgress(desc: string, props: any, msg?: string) {
        var p = this.progress[desc];
        if (props.done) {
            if (p) {
                p.remove(); delete this.progress[desc];
            }
        }
        else if (props.download && p) {
            var span = p.find('span.progress');
            if (span.length == 0)
                p.append(span = $('<span>').addClass('progress'));
            if (props.download.total) {
                var ratio = props.download.downloaded / props.download.total;
                span.text(`${(ratio * 100).toFixed(1)}%`);
            }
            else span.text(props.download.downloaded);
        }
        else {
            this.progress[desc] = this.write(msg || `${desc}...`);
        }
    }

}


export { InteractiveConsole }
