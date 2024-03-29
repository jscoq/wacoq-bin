(* Init options reside in this separate module to avoid some cyclic deps. *)

type startup_config = 
  { implicit_libs: bool          [@default true]
  ; coqlib: string option        [@default None]
  ; lib_path: string list        [@default ["/lib"]]
  ; coq_options: coq_option list [@default []]  (* this one is in both startup and doc because I could not make up my mind *)
  ; debug: debug_config          [@default {coq=false; stm=false}]
  }
and debug_config =
  { coq: bool                    [@default false]
  ; stm: bool                    [@default false]
  }
and coq_option = (string list * Goptions.option_value)

type doc_config =
  { top_name: string             [@default "WACoq"]
  ; mode: top_mode               [@default Interactive]
  ; lib_init: string list        [@default ["Coq.Init.Prelude"]]
  ; coq_options: coq_option list [@default []]
  }
and top_mode = Interactive | Vo