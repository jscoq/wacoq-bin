

type startup_params = 
  { top_name: string             [@default "WACoq"]
  ; implicit_libs: bool          [@default true]
  ; require_libs: string list    [@default ["Coq.Init.Prelude"]]
  ; coqlib: string option        [@default None]
  ; debug: debug_params          [@default {coq=false; stm=false}]
  }
and debug_params =
  { coq: bool                    [@default false]
  ; stm: bool                    [@default false]
  }
