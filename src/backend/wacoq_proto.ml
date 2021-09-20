
module Stateid  = Serlib.Ser_stateid

module Feedback = Serlib.Ser_feedback
module Names    = Serlib.Ser_names
module Evar     = Serlib.Ser_evar
module Loc      = Serlib.Ser_loc
module Pp       = Serlib.Ser_pp

module Libnames = Serlib.Ser_libnames
module Goptions = Serlib.Ser_goptions

module Ser_nametab = struct
  include Nametab
  type object_prefix = [%import: Nametab.object_prefix]
   [@@deriving yojson]
end

module Nametab = Ser_nametab

module Ser_inspect = struct
  include Inspect
  type qualified_object_prefix = [%import: Inspect.qualified_object_prefix]
  [@@deriving yojson]
  type qualified_name = [%import: Inspect.qualified_name]
  [@@deriving yojson]
end

module Inspect = Ser_inspect

module Seq = struct
  type 'a t = 'a Seq.t
  let to_yojson f s = `List (Seq.fold_left (fun l x -> f x :: l) [] s |> List.rev)
end

module Proto = struct

module Goals = struct

  type 'a hyp =
    [%import: 'a Serapi.Serapi_goals.hyp]
    [@@deriving to_yojson]

  type info =
    [%import: Serapi.Serapi_goals.info]
    [@@deriving to_yojson]

  type 'a reified_goal =
    [%import: 'a Serapi.Serapi_goals.reified_goal]
    [@@deriving to_yojson]

  type 'a ser_goals =
    [%import: 'a Serapi.Serapi_goals.ser_goals]
    [@@deriving to_yojson]

  type t = Pp.t reified_goal ser_goals
    [@@deriving to_yojson]

end

type startup_config =
  [%import: Icoq_init.startup_config]
  [@@deriving yojson]
and debug_config =
  [%import: Icoq_init.debug_config]
  [@@deriving yojson]
and coq_option =
  [%import: Icoq_init.coq_option]
  [@@deriving yojson]

type doc_config =
  [%import: Icoq_init.doc_config]
  [@@deriving yojson]
and top_mode =
  [%import: Icoq_init.top_mode]
  [@@deriving yojson]

type in_mode = Proof | General
let in_mode_to_yojson = function Proof -> `String "Proof" | General -> `Null

type search_query =
  [%import: Inspect.search_query]
  [@@deriving yojson]

type query =
  | Mode
  | Goals
  | Vernac of string
  | Inspect of search_query
  [@@deriving yojson]

type wacoq_cmd =
  | Init    of startup_config
  | NewDoc  of doc_config
  | Add     of Stateid.t option * Stateid.t option * string * bool
  | Exec    of Stateid.t
  | Cancel  of Stateid.t

  | Query   of Stateid.t * Feedback.route_id * query

  | RefreshLoadPath

  | Load    of string
  | Compile of string
  [@@deriving yojson]

type wacoq_answer =
  | CoqInfo   of string
  | Ready     of Stateid.t
  | Added     of Stateid.t * Loc.t option
  | BackTo    of Stateid.t
  | Feedback  of Feedback.feedback
  | Pending   of Stateid.t option * string option * string list

  (* Query responses *)
  | ModeInfo  of Stateid.t * in_mode
  | GoalInfo  of Stateid.t * Goals.t option
  | SearchResults of Feedback.route_id * Inspect.qualified_name Seq.t

  | Loaded    of string * Stateid.t
  | Compiled  of string

  | CoqExn    of { loc : Loc.t option
                 ; sid : (Stateid.t * Stateid.t) option
                 ; msg : string
                 ; pp : Pp.t
                 }
  | JsonExn   of string
  [@@deriving to_yojson]

end
