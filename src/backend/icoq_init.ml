

type startup_params = 
  { top_name: string             [@default "WACoq"]
  ; implicit_libs: bool          [@default true]
  ; require_libs: string list    [@default ["Coq.Init.Prelude"]]
  }
