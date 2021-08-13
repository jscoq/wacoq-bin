

type startup_config = 
  { implicit_libs: bool          [@default true]
  ; coqlib: string option        [@default None]
  ; coq_options: coq_option list [@default []]    (** @todo move this to doc_config in 8.14 *)
  ; debug: debug_config          [@default {coq=false; stm=false}]
  }
and debug_config =
  { coq: bool                    [@default false]
  ; stm: bool                    [@default false]
  }
and coq_option = (string list * Goptions.option_value)

type doc_config =
  { top_name: string             [@default "WACoq"]
  ; lib_init: string list        [@default ["Coq.Init.Prelude"]]
  ; lib_path: string list        [@default ["/lib"]]
  ; mode: top_mode               [@default Interactive]
  }
and top_mode = Interactive | Vo