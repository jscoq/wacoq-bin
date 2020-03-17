open Wacoq_proto.Proto


let make_coqpath ?(implicit=true) unix_path lib_path =
  Loadpath.{
    path_spec = VoPath {
        unix_path = unix_path;
        coq_path = Names.(DirPath.make @@ List.rev_map Id.of_string lib_path);
        has_ml = AddRecML;
        implicit = implicit
      };
    recursive = true;
  }

let default_load_path = [make_coqpath "/lib/plugins" ["Coq"];
                         make_coqpath "/lib/theories" ["Coq"]]

let init () =
  (* Coqinit.set_debug (); *)

  Lib.init();
  Global.set_engagement Declarations.PredicativeSet;
  Global.set_VM false;
  Global.set_native_compiler false;

  Stm.init_core ();

  (* Create an initial state of the STM *)
  let sertop_dp = Stm.TopLogical (Libnames.dirpath_of_string "Lab") in
  let ndoc = { Stm.doc_type = Stm.Interactive sertop_dp;
               require_libs = ["Coq.Init.Prelude", None, Some true];
               iload_path = default_load_path;
               stm_options = Stm.AsyncOpts.default_opts } in
  let ndoc, nsid = Stm.new_doc ndoc in

  print_endline @@ "Stm sid=" ^ Stateid.to_string nsid;

  ndoc, nsid 

let next sid = Stateid.of_int @@ Stateid.to_int sid + 1


(*
 * Main Coq interaction entry point
 *)
module Interpreter = struct

  let state : (Stm.doc * Stateid.t list) option ref = ref None

  let error : Stateid.t option ref = ref None

  let _fresh_cnt = ref 1

  let here () =
    let (doc, states) = Option.get !state in (doc, List.hd states)

  let tip () = let (_, tip) = here () in tip

  let push doc sid =
    let (_, states) = Option.get !state in
    state := Some (doc, sid :: states)

  let back doc sid =
    let (_, states) = Option.get !state in
    let rec drop_until p = function
      | [] -> raise Not_found
      | x :: xs -> if p x then x :: xs else drop_until p xs
    in
    try
      state := Some (doc, drop_until (fun x -> x = sid) states)
    with Not_found ->
      failwith @@ "(assertion failed) missing sid " ^ Stateid.to_string sid

  let prev sid =
    let (_, states) = Option.get !state in
    List.find_opt (fun x -> Stateid.newer_than sid x) states
      |> Option.default Stateid.initial

  let fresh () =
    let n = !_fresh_cnt + 1 in
    _fresh_cnt := n ; Stateid.of_int n

  let parse stm =
    let doc, tip = here () in
    let pa = Pcoq.Parsable.make (Stream.of_string stm) in
    let entry = Pvernac.main_entry in
    Option.get @@ Stm.parse_sentence ~doc ~entry tip pa

  let add_ast ?from ?newid ast =
    let doc, tip = here () in
    let ontop = Option.default tip from in
    let newtip = match newid with | Some n -> n | _ -> fresh () in
    let doc, new_sid, _ = Stm.add ~doc ~ontop ~newtip true ast in
    push doc new_sid;
    print_endline @@ "Add sid=" ^ Stateid.to_string new_sid;
    new_sid

  let add ?from ?newid stm =
    add_ast ?from ?newid (parse stm)

  let observe ~sid =
    let doc, states = Option.get !state in
    state := Some (Stm.observe ~doc sid, states);
    sid

  let cancel ~sid =
    let (doc, _) = Option.get !state in
    let doc, _ = Stm.edit_at ~doc (prev sid) in
    let new_tip = Stm.get_current_state ~doc in
    print_endline @@ "Cancel " ^ Stateid.to_string sid;
    back doc new_tip;
    new_tip
    
  let add_observe ?newid stm =
    observe ~sid:(add ?newid stm)

  let get_goals ~sid =
    let doc, _ = here () in
    let ppx env sigma x = Printer.pr_ltype_env env sigma x in
    Serapi.Serapi_goals.get_goals_gen ppx ~doc sid

  let refresh_load_path () =
    List.iter Loadpath.add_coq_path default_load_path

  let fb_queue : Feedback.feedback list ref = ref []

  let fb_handler (feedback : Feedback.feedback) =
    fb_queue := feedback :: !fb_queue ;
    match feedback.contents with
      Message(l, _, msg) -> 
        print_endline @@ "-------\n" ^ Pp.string_of_ppcmds msg ;
        if l = Error then ( print_endline @@ "ERROR " ^ Stateid.to_string feedback.span_id ; error := Some feedback.span_id )
    | _ -> ()

  let fb_flush () = let fb = !fb_queue in fb_queue := []; fb

  let cleanup () =
    match !error with
    | Some sid -> error := None ; ignore @@ cancel ~sid
    | _ -> ()

  let init () = 
    ignore @@ Feedback.add_feeder fb_handler;
    let doc, initial = init () in
    state := Some (doc, [initial]);
    initial

end


let jscoq_execute = function
  | Init ->                    [Ready (Interpreter.tip ())]
  | Add (from, newid, stm, _) ->  [Added (Interpreter.add ?from ?newid stm, None)]
  | Exec sid ->                ignore @@ Interpreter.observe ~sid ; []
  | Cancel sid ->              [BackTo (Interpreter.cancel ~sid)]
  | Goals sid ->               [GoalInfo (sid, Interpreter.get_goals ~sid)]
  | Query (_, _, _) ->         [(* not implemented*)]
  | Inspect (_, _, _) ->       [(* not implemented*)]
  | RefreshLoadPath ->         Interpreter.refresh_load_path () ; []

let fb_flush () =
  List.rev_map (fun fb -> Feedback fb) @@ Interpreter.fb_flush ()

let handleRequest json_str =
  let resp =
  try
    let json = Yojson.Safe.from_string json_str        in
    let cmd = [%of_yojson: wacoq_cmd] json             in
    match cmd with
      | Result.Error e -> [JsonExn e]
      | Result.Ok cmd -> jscoq_execute cmd
  with exn ->
    let (e, info) = CErrors.push exn                   in
    [CoqExn (Loc.get_loc info, Stateid.get info, CErrors.iprint (e, info))]
  in
  let fb_and_resp = fb_flush () @ resp in
  Interpreter.cleanup () ;
  Yojson.Safe.to_string @@ `List (List.map [%to_yojson: wacoq_answer] fb_and_resp)

let _ =
  try
    ignore @@ Interpreter.init () ;  (* must be called before '_' exits?.. *)
    Callback.register "post" handleRequest
  with CErrors.UserError(Some x, y) ->
    print_endline @@ "error! " ^ x ^ ": " ^ Pp.string_of_ppcmds y
