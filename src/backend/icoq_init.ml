

type startup_config = 
  { implicit_libs: bool          [@default true]
  ; coqlib: string option        [@default None]
  ; debug: debug_config          [@default {coq=false; stm=false}]
  }
and debug_config =
  { coq: bool                    [@default false]
  ; stm: bool                    [@default false]
  }

type doc_config =
  { top_name: string             [@default "WACoq"]
  ; lib_init: string list        [@default ["Coq.Init.Prelude"]]
  ; lib_path: string list        [@default ["/lib"]]
  ; mode: top_mode               [@default Interactive]
  }
and top_mode = Interactive | Vo
