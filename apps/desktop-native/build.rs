//! Windows: embute o ícone (assets/icon.ico) no .exe, para o Explorer, a barra
//! de tarefas e os atalhos.

fn main() {
    println!("cargo:rerun-if-changed=assets/icon.ico");
    println!("cargo:rerun-if-changed=assets/scale.rc");
    #[cfg(windows)]
    embed_resource::compile("assets/scale.rc", embed_resource::NONE)
        .manifest_required()
        .expect("falha ao embutir o icone do Windows");
}
