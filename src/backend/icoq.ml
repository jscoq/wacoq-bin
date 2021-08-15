open Wacoq_proto.Proto


external emit : string -> unit = "wacoq_emit" (* implemented in `core.ts` *)

let make_coqpath ?(implicit=true) unix_path lib_path =
  Loadpath.{
    unix_path = unix_path;
    coq_path = Names.(DirPath.make @@ List.rev_map Id.of_string lib_path);
    has_ml = true;
    implicit = implicit;
    recursive = true
  }

let native_load_path coqlib =
  List.map 
    (fun subdir -> make_coqpath (coqlib ^ subdir) ["Coq"])
    ["/theories"; "/plugins"]

let init_load_path coqlib_opt load_path =
  (match coqlib_opt with
   | Some coqlib -> native_load_path coqlib
   | _ -> [])
  @
  List.map (fun pel -> make_coqpath pel []) load_path

let default_warning_flags = "-notation-overridden"  (* for ssreflect :/ *)

let core_config : startup_config option ref = ref None

let init config =
  Dynlink.allow_unsafe_modules true; (* this is needed for camlp4 and some others *)

  (* if (config.debug.coq) then
    Coqinit.set_debug (); *)  (* @todo *)

  Lib.init ();

  Global.set_engagement Declarations.PredicativeSet;
  Global.set_VM false;
  Global.set_native_compiler false;
  Flags.set_native_compiler false;  (* need both? *)
  CWarnings.set_flags default_warning_flags;

  Stm.init_core ();
  core_config := Some config


let start config vo_load_path ml_load_path =
  (* Create an initial state of the STM *)
  let doc_type = match config.mode with
    | Interactive -> let dp = Libnames.dirpath_of_string config.top_name in 
                     Stm.Interactive (Coqargs.TopLogical dp) 
    | Vo ->          Stm.VoDoc config.top_name
  in
  let require_libs = List.map (fun lib -> 
    Coqargs.RequireInjection(lib, None, Some false)) config.lib_init in
  let ndoc = Stm.{ doc_type;
                   injections = require_libs;
                   (*vo_load_path; ml_load_path; *)
                   stm_options = Stm.AsyncOpts.default_opts } in
  (* @todo handle `config.debug.stm` and `config.coq_options` as well *)
  Stm.new_doc ndoc


let coq_exn_info exn =
  let (e, info) = Exninfo.capture exn in
  let pp_exn    = CErrors.iprint (e, info) in
  CoqExn (Loc.get_loc info, Stateid.get info, pp_exn)


(*
 * Main Coq interaction entry point
 *)
module Interpreter = struct

  let state : (Stm.doc * Stateid.t list) option ref = ref None

  let load_path : Loadpath.vo_path list ref = ref []
  let error : Stateid.t option ref = ref None

  let _fresh_cnt = ref 1

  let version =
    Coq_config.version, Wacoq_version.date, Coq_config.caml_version, Coq_config.vo_version

  let init = init

  let new_doc config =
    let core = Option.get !core_config in
    load_path := init_load_path core.coqlib config.lib_path;

    let doc, initial = start config !load_path [] in
    state := Some (doc, [initial]);
    initial

  let here () =
    let (doc, states) = Option.get !state in (doc, List.hd states)

  let at sid =
    let doc, tip = here () in
    (doc, if sid = Stateid.dummy then tip else sid)

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
    back doc new_tip;
    new_tip
    
  let add_observe ?newid stm =
    observe ~sid:(add ?newid stm)

  let get_goals ~sid =
    let doc, _ = here () in
    let ppx env sigma x = Printer.pr_ltype_env env sigma x in
    Serapi.Serapi_goals.get_goals_gen ppx ~doc sid

  let refresh_load_path () =
    List.iter Loadpath.add_vo_path !load_path

  let requires ast =
    match ast.CAst.v with
    | Vernacexpr.{ expr = VernacRequire (prefix, _export, module_refs); _ } ->
      Some ((prefix, module_refs))
    | _ -> None
    
  let query sid query ~route =
    let doc, sid = at sid in
    let pa = Pcoq.Parsable.make (Stream.of_string query) in
    Stm.query ~doc ~at:sid ~route pa

  let mode_at ~sid =
    let doc, sid = at sid in
    match Stm.state_of_id ~doc sid with
    | `Valid (Some { lemmas = Some _; _ }) -> Proof 
    | _ -> General

  let inspect sid q =
    let doc, sid = at sid in
    Inspect.inspect ~doc sid q

  let cleanup () =
    match !error with
    | Some sid -> error := None ; ignore @@ cancel ~sid
    | _ -> ()

end

module Compiler = struct

  open Interpreter

  let load filename ~echo =
    let doc, tip = here () in
    let vernac_state = Vernac.State.
      { doc = doc; sid = tip; proof = None; time = false } in
    (* loading with ~check:true to avoid some stack overflows in stm *)
    let vernac_state' =
      Vernac.load_vernac ~echo ~check:true ~interactive:false
                          ~state:vernac_state filename in
    push vernac_state'.doc vernac_state'.sid;
    vernac_state'.sid

  let rec compile_vo filename ~snapshot =
    let doc, _ = here () in
    ignore @@ Stm.join ~doc;
    let dirp = Lib.library_dp () in
    (* freeze and un-freeze to to allow "snapshot" compilation *)
    (*  (normally, save_library_to closes the lib)             *)
    (if snapshot then freeze_unfreeze else (fun op -> op ())) (fun () ->
      Library.save_library_to Library.ProofsTodoNone 
        ~output_native_objects:false dirp filename (Global.opaque_tables ())
    )

  and freeze_unfreeze op =
    let frz = Vernacstate.freeze_interp_state ~marshallable:false in
    op ();
    Vernacstate.unfreeze_interp_state frz

end


let info_string () =
  let coqv, build_date, ccv, cmag = Interpreter.version             in
  let wacoqv = Wacoq_version.version                                in
  let info1 = Printf.sprintf
              "waCoq %s, Coq %s/%4d,\n  compiled on %s\n"
              wacoqv coqv (Int32.to_int cmag) build_date            in
  let info2 = Printf.sprintf
              "OCaml %s (wasi-sdk-12)\n" (* @oops *) ccv            in
  info1 ^ info2


let add_or_pend ?from ?newid stm ~resolve =
  let ast = Interpreter.parse stm in
  let req = if resolve then None else Interpreter.requires ast in
  match req with
  | Some (prefix, module_refs) ->
    let soq = Libnames.string_of_qualid in
    [Pending (newid, Option.map soq prefix, List.map soq module_refs)]
  | _ ->
    [Added (Interpreter.add_ast ?from ?newid ast, ast.CAst.loc)]


let exec_query sid ~route query =
  match query with
  | Goals -> [GoalInfo (sid, Interpreter.get_goals ~sid)]
  | Mode ->  [ModeInfo (sid, Interpreter.mode_at ~sid)]
  | Vernac command -> Interpreter.query sid command ~route; []
  | Inspect q -> [SearchResults (route, Interpreter.inspect sid q)]


let capture_exn ?sid ?(rid=0) ?(status=fun c -> []) ?(level=Feedback.Error) op =
  let sid = Option.default Stateid.dummy sid in
  let feed contents = Feedback { doc_id = 0; span_id = sid; route = rid; contents } in
  let fin (c: Feedback.feedback_content) = List.map feed (status c) in
  try op () @ fin Complete
  with exn ->
    let CoqExn(loc,_,msg) = coq_exn_info exn [@@warning "-8"] in
    [feed (Message(level, loc, msg))] @ fin Incomplete


let wacoq_execute = function
  | Init config ->             Interpreter.init config; []
  | NewDoc config ->           [Ready (Interpreter.new_doc config)]
  | Add (from, newid, stm, resolve) -> 
                               capture_exn ?sid:newid (fun () -> 
                                 add_or_pend ?from ?newid stm ~resolve)
  | Exec sid ->                ignore @@ Interpreter.observe ~sid ; []
  | Cancel sid ->              [BackTo (Interpreter.cancel ~sid)]
  | Query (sid, rid, q) ->     capture_exn ~sid ~rid ~status:(fun c -> [c]) ~level:Warning
                                 (fun () -> exec_query sid ~route:rid q)
  | RefreshLoadPath ->         Interpreter.refresh_load_path () ; []

  | Load filename ->           [Loaded (filename, Compiler.load filename ~echo:false)]
  | Compile filename ->        Compiler.compile_vo filename ~snapshot:false;
                               [Compiled filename]

let deserialize (json : string) =
  [%of_yojson: wacoq_cmd] @@ Yojson.Safe.from_string json

let serialize (answers : wacoq_answer list) =
  Yojson.Safe.to_string @@ `List (List.map [%to_yojson: wacoq_answer] answers)

let fb_handler (fb : Feedback.feedback) =
  emit @@ serialize [Feedback fb]

let handleRequest json_str =
  let resp =
  try
    let cmd = deserialize json_str                     in
    match cmd with
      | Result.Error e -> [JsonExn e]
      | Result.Ok cmd -> wacoq_execute cmd
  with exn ->
    let (e, info) = Exninfo.capture exn                in
    [CoqExn (Loc.get_loc info, Stateid.get info, CErrors.iprint (e, info))]
  in
  Interpreter.cleanup () ;
  serialize resp

let handleRequestsFromStdin () =
  try
    while true do
      emit @@ handleRequest @@ Stdlib.read_line ()
    done
  with End_of_file -> ()


let () =
  try
    emit @@ serialize [CoqInfo (info_string ())] ;
    ignore @@ Feedback.add_feeder fb_handler ;
    Callback.register "wacoq_post" handleRequest ;
    if (Array.length Sys.argv > 1) && Sys.argv.(1) = "-stdin" then
      handleRequestsFromStdin ()
  with CErrors.UserError(Some x, y) ->
    print_endline @@ "error! " ^ x ^ ": " ^ Pp.string_of_ppcmds y
