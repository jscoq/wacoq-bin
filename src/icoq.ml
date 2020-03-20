open Wacoq_proto.Proto


external emit : string -> unit = "wacoq_emit"

let wacoq_version = "0.11.0-alpha1"

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

let default_load_path = [make_coqpath "/lib" []]

let init params =
  (* Coqinit.set_debug (); *)

  Lib.init();
  Global.set_engagement Declarations.PredicativeSet;
  Global.set_VM false;
  Global.set_native_compiler false;

  Stm.init_core ();

  (* Create an initial state of the STM *)
  let sertop_dp = Stm.TopLogical (Libnames.dirpath_of_string params.top_name) in
  let require_libs = List.map (fun lib -> (lib, None, Some true)) params.require_libs in
  let ndoc = { Stm.doc_type = Stm.Interactive sertop_dp;
               require_libs = require_libs;
               iload_path = default_load_path;
               stm_options = Stm.AsyncOpts.default_opts } in
  Stm.new_doc ndoc


(*
 * Main Coq interaction entry point
 *)
module Interpreter = struct

  let state : (Stm.doc * Stateid.t list) option ref = ref None

  let error : Stateid.t option ref = ref None

  let _fresh_cnt = ref 1

  let version =
    Coq_config.version, Coq_config.date, Coq_config.compile_date, Coq_config.caml_version, Coq_config.vo_magic_number

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

  let cleanup () =
    match !error with
    | Some sid -> error := None ; ignore @@ cancel ~sid
    | _ -> ()

  let init params = 
    let doc, initial = init params in
    state := Some (doc, [initial]);
    initial

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

  let compile_vo filename =
    let doc, _ = here () in
    ignore @@ Stm.join ~doc;
    let dirp = Lib.library_dp () in
    (* freeze and un-freeze to to allow "snapshot" compilation *)
    (*  (normally, save_library_to closes the lib)             *)
    let frz = Vernacstate.freeze_interp_state ~marshallable:false in
    Library.save_library_to Library.ProofsTodoNone 
      ~output_native_objects:false dirp filename (Global.opaque_tables ());
    Vernacstate.unfreeze_interp_state frz

end


let info_string () =
  let coqv, coqd, ccd, ccv, cmag = Interpreter.version              in
  let info1 = Printf.sprintf
              "waCoq %s, Coq %s/%4d (%s),\n  compiled on %s\n"
              wacoq_version coqv cmag coqd ccd                      in
  let info2 = Printf.sprintf
              "OCaml %s (wasi-sdk)\n" ccv                           in
  info1 ^ info2


let jscoq_execute = function
  | Init params ->             [Ready (Interpreter.init params)]
  | Add (from, newid, stm, _) ->  
                               [Added (Interpreter.add ?from ?newid stm, None)]
  | Exec sid ->                ignore @@ Interpreter.observe ~sid ; []
  | Cancel sid ->              [BackTo (Interpreter.cancel ~sid)]
  | Goals sid ->               [GoalInfo (sid, Interpreter.get_goals ~sid)]
  | Query (_, _, _) ->         [(* not implemented*)]
  | Inspect (_, _, _) ->       [(* not implemented*)]
  | RefreshLoadPath ->         Interpreter.refresh_load_path () ; []

  | Load filename ->           [Added (Compiler.load filename ~echo:false, None)]
  | Compile filename ->        Compiler.compile_vo filename; []

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
      | Result.Ok cmd -> jscoq_execute cmd
  with exn ->
    let (e, info) = CErrors.push exn                   in
    [CoqExn (Loc.get_loc info, Stateid.get info, CErrors.iprint (e, info))]
  in
  Interpreter.cleanup () ;
  serialize resp


let _ =
  try
    emit @@ serialize [CoqInfo (info_string ())] ;
    ignore @@ Feedback.add_feeder fb_handler ;
    Callback.register "wacoq_post" handleRequest
  with CErrors.UserError(Some x, y) ->
    print_endline @@ "error! " ^ x ^ ": " ^ Pp.string_of_ppcmds y
