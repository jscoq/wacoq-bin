type search_query =
  | All
  | CurrentFile
  | ModulePrefix of string
  | Keyword of string
  | Locals

type qualified_object_prefix = {
  dp: Names.DirPath.t;
  mod_ids: Names.Id.t list
}

type qualified_name = {
  prefix: qualified_object_prefix;
  basename: Names.Id.t
}

let string_of_qualified_name qn =
  let {prefix = {dp; mod_ids}; basename} = qn in (* todo use `ids` as well *)
  let dp = match Names.DirPath.repr dp with
    | [] -> [] | _ -> [Names.DirPath.to_string dp] in
  String.concat "." (dp @ (List.map Names.Id.to_string mod_ids) @ [Names.Id.to_string basename])

(* - basic utilities - *)

let string_contains s1 s2 =  (* from Rosetta Code *)
  let len1 = String.length s1
  and len2 = String.length s2 in
  if len1 < len2 then false else
    let rec aux i =
      (i >= 0) && ((String.sub s1 i len2 = s2) || aux (pred i))
    in
    aux (len1 - len2)

let rec seq_append s1 s2 = fun () ->  (* Stdlib does not provide this :( *)
  match s1 () with
  | Seq.Nil -> s2 ()
  | Seq.Cons (x, xs) -> Seq.Cons (x, seq_append xs s2)

let is_within qn prefix =
  let {prefix = {dp}} = qn in
  Libnames.is_dirpath_prefix_of prefix dp

let dp_of_mp mp = (* Like `Lib.dp_of_mp`, but includes the module path *)
  let dp, ids = Lib.split_modpath mp in
  Names.DirPath.make @@ Names.DirPath.repr dp @ ids

let qualified_object_prefix_of_mp mp =
  let dp, mod_ids = Lib.split_modpath mp in {dp; mod_ids}

let qualified_object_prefix_of_dp dp = {dp; mod_ids = []}

let qualified_name_of_kn kn =
  let mp, l = Names.KerName.repr kn in
  {prefix = qualified_object_prefix_of_mp mp; basename = Names.Label.to_id l}

let full_path_of_kn kn =
  let mp, l = Names.KerName.repr kn in
  Libnames.make_path (dp_of_mp mp) (Names.Label.to_id l)

let full_path_of_constant c = full_path_of_kn (Names.Constant.user c)

let qualified_name_of_constant c = qualified_name_of_kn (Names.Constant.user c)

let qualified_name_of_full_path fp =
  let (dp, id) = Libnames.repr_path fp in
  {prefix = qualified_object_prefix_of_dp dp; basename = id}

(* Get current proof context *)
let context_of_st m = match m with
  | `Valid (Some { Vernacstate.lemmas = Some lemma ; _ } ) ->
    Vernacstate.LemmaStack.with_top lemma
      ~f:(fun pstate -> Declare.Proof.get_current_context pstate)
  | _ ->
    let env = Global.env () in Evd.from_env env, env

let context_of_stm ~doc sid =
  let st = Stm.state_of_id ~doc sid in
  context_of_st st

(* Get constants in global scope *)
let inspect_globals ~env () =
  let global_consts = List.to_seq @@
      Environ.fold_constants (fun name _ l -> name :: l) env [] in
  Seq.map qualified_name_of_constant global_consts


let libobj_is_leaf obj =
  match obj with
  | Lib.Leaf _ -> true | _ -> false [@@warning "-4"]

let full_path_sibling path id =
  Libnames.make_path (Libnames.dirpath path) id  

let lookup_inductive env path mi =
  let open Declarations in
  try
    let defn_body = Environ.lookup_mind mi env in
    Array.to_seq defn_body.mind_packets
      |> Seq.map (fun p -> full_path_sibling path (p.mind_typename))
    (* TODO include constructors *)
  with Not_found -> Seq.empty

let find_definitions env obj_path =
  let open Names.GlobRef in
  try
    match Nametab.global_of_path obj_path with
    | ConstRef _ -> Seq.return obj_path
    | IndRef (mi,_) -> lookup_inductive env obj_path mi
    | _ -> Seq.empty
  with Not_found -> Seq.empty

(* Get definitions in current module *)
let inspect_library ~env () =
  let ls = Lib.contents () in
  Seq.flat_map (fun ((obj_path, _), obj) ->
    if libobj_is_leaf obj then find_definitions env obj_path
    else Seq.empty)
    (List.to_seq ls) |> Seq.map qualified_name_of_full_path

(* Get local names in proof context *)
let inspect_locals ~env ?(dir_path=Names.DirPath.empty) () =
  let named_ctx = Environ.named_context env in
  List.to_seq (Context.Named.to_vars named_ctx |> Names.Id.Set.elements) |>
    Seq.map (Libnames.make_path dir_path)
    |> Seq.map qualified_name_of_full_path



let symbols_for (q : search_query) env =
    match q with
    | Locals       -> inspect_locals  ~env ()
    | CurrentFile  -> seq_append (inspect_library ~env ())
                                 (inspect_locals  ~env ())
    | _            -> inspect_globals ~env ()
    [@@warning "-4"]

let filter_by (q : search_query) =
  match q with
  | All | CurrentFile | Locals -> (fun _ -> true)
  | ModulePrefix prefix -> 
    let dp = Libnames.dirpath_of_string prefix in (fun nm -> is_within nm dp)
  | Keyword s -> (fun nm -> string_contains (string_of_qualified_name nm) s)

let inspect ~doc sid q =
    let _, env = context_of_stm ~doc sid in
    let symbols = symbols_for q env in
    Seq.filter (filter_by q) symbols
