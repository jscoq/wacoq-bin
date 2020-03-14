
module Stateid  = Serlib.Ser_stateid

module Feedback = Serlib.Ser_feedback
module Pp = Serlib.Ser_pp

module Proto = struct

type jscoq_cmd =
  | Init
  | Add of string
  | Cancel of Stateid.t
  | Goals of Stateid.t
  | RefreshLoadPath
  [@@deriving yojson]

type jscoq_answer =
  | Ready of Stateid.t
  | Added of Stateid.t * int option
  | BackTo of Stateid.t
  | GoalInfo of Pp.t list
  | Feedback of Feedback.feedback
  | JsonExn of string
  | CoqExn of Pp.t
  [@@deriving to_yojson]

end
