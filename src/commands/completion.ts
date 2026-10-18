import { defineCommand } from 'citty';

const BASH = `# skl-x bash completion
# Install: source <(skl completion bash)
_skl_x_completions() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local cmds="list ls remove rm cost cst usage usg completion add sln update up uninstall"
  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "\${cmds} -h --help -v --version" -- "\${cur}") )
    return 0
  fi

  local sub="\${COMP_WORDS[1]}"
  case "\${sub}" in
    rm|remove)
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "-g --global -y --yes -x --reject -m --mode --lock-only --agents-only --claude-only -h --help" -- "\${cur}") )
      elif [ "\${prev}" = "-m" ] || [ "\${prev}" = "--mode" ]; then
        COMPREPLY=( $(compgen -W "sm md lg" -- "\${cur}") )
      else
        local names
        local scope=""
        for w in "\${COMP_WORDS[@]}"; do
          if [ "\${w}" = "-g" ] || [ "\${w}" = "--global" ]; then scope="-g"; fi
        done
        names="$(skl list --names \${scope} 2>/dev/null)"
        COMPREPLY=( $(compgen -W "\${names}" -- "\${cur}") )
      fi
      return 0
      ;;
    add)
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "-s --skill -a --agent -y --yes -m --mode -h --help" -- "\${cur}") )
      elif [ "\${prev}" = "-a" ] || [ "\${prev}" = "--agent" ]; then
        COMPREPLY=( $(compgen -W "codex claude-code" -- "\${cur}") )
      elif [ "\${prev}" = "-m" ] || [ "\${prev}" = "--mode" ]; then
        COMPREPLY=( $(compgen -W "sm md lg" -- "\${cur}") )
      fi
      return 0
      ;;
    sln)
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "-s --skill -x --reject -a --agent -y --yes -m --mode -h --help" -- "\${cur}") )
      elif [ "\${prev}" = "-a" ] || [ "\${prev}" = "--agent" ]; then
        COMPREPLY=( $(compgen -W "codex claude-code" -- "\${cur}") )
      elif [ "\${prev}" = "-m" ] || [ "\${prev}" = "--mode" ]; then
        COMPREPLY=( $(compgen -W "sm md lg" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -d -- "\${cur}") )
      fi
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      return 0
      ;;
  esac
}
complete -F _skl_x_completions skl
complete -F _skl_x_completions skl-x
`;

const ZSH = `# skl-x zsh completion
# Install: source <(skl completion zsh)
_skl_x() {
  local -a cmds
  cmds=(
    'list:List skills per source'
    'ls:Alias for list'
    'remove:Delete on-disk skill dirs'
    'rm:Alias for remove'
    'cost:Show ambient context cost'
    'cst:Alias for cost'
    'usage:Show skill usage'
    'usg:Alias for usage'
    'completion:Print shell completion script'
    'add:Install skills via npx skills add'
    'sln:Symlink skills from a local clone'
    'update:Install the latest skl-x globally'
    'up:Alias for update'
    'uninstall:Remove the global skl-x'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' cmds
    return
  fi
  local sub=\${words[2]}
  case $sub in
    rm|remove)
      if [[ \${words[CURRENT]} == -* ]]; then
        _values 'flag' \\
          '-g[global scope]' '--global[global scope]' \\
          '-y[skip confirmation]' '--yes[skip confirmation]' \\
          '-x[with .: skills to keep]' '--reject[with .: skills to keep]' \\
          '-m[sm, md or lg]' '--mode[sm, md or lg]' \\
          '--lock-only[only remove lock entry]' \\
          '--agents-only[only remove from .agents/skills]' \\
          '--claude-only[only remove from .claude/skills]'
      elif [[ \${words[CURRENT-1]} == -m || \${words[CURRENT-1]} == --mode ]]; then
        _values 'mode' sm md lg
      else
        local scope=""
        for w in \${words[@]}; do
          if [[ $w == "-g" || $w == "--global" ]]; then scope="-g"; fi
        done
        local -a names
        names=(\${(f)"$(skl list --names $scope 2>/dev/null)"})
        compadd -- $names
      fi
      ;;
    add)
      if [[ \${words[CURRENT]} == -* ]]; then
        _values 'flag' \\
          '-s[skill names]' '--skill[skill names]' \\
          '-a[codex or claude-code]' '--agent[codex or claude-code]' \\
          '-y[skip prompts]' '--yes[skip prompts]' \\
          '-m[sm, md or lg]' '--mode[sm, md or lg]'
      elif [[ \${words[CURRENT-1]} == -a || \${words[CURRENT-1]} == --agent ]]; then
        _values 'agent' codex claude-code
      elif [[ \${words[CURRENT-1]} == -m || \${words[CURRENT-1]} == --mode ]]; then
        _values 'mode' sm md lg
      fi
      ;;
    sln)
      if [[ \${words[CURRENT]} == -* ]]; then
        _values 'flag' \\
          '-s[skill names]' '--skill[skill names]' \\
          '-x[every skill except these]' '--reject[every skill except these]' \\
          '-a[codex or claude-code]' '--agent[codex or claude-code]' \\
          '-y[replace without asking]' '--yes[replace without asking]' \\
          '-m[sm, md or lg]' '--mode[sm, md or lg]'
      elif [[ \${words[CURRENT-1]} == -a || \${words[CURRENT-1]} == --agent ]]; then
        _values 'agent' codex claude-code
      elif [[ \${words[CURRENT-1]} == -m || \${words[CURRENT-1]} == --mode ]]; then
        _values 'mode' sm md lg
      else
        _files -/
      fi
      ;;
    completion)
      _values 'shell' bash zsh fish
      ;;
  esac
}
compdef _skl_x skl skl-x
`;

const FISH = `# skl-x fish completion
# Install: skl completion fish | source
function __skl_x_skill_names
  set -l scope ""
  for w in (commandline -opc)
    if test "$w" = "-g" -o "$w" = "--global"
      set scope "-g"
    end
  end
  skl list --names $scope 2>/dev/null
end

function __skl_x_needs_command
  set -l cmd (commandline -opc)
  test (count $cmd) -le 1
end

function __skl_x_using_subcommand
  set -l cmd (commandline -opc)
  if test (count $cmd) -lt 2; return 1; end
  test "$cmd[2]" = "$argv[1]"
end

complete -c skl -n __skl_x_needs_command -a 'list ls remove rm cost cst usage usg completion add sln update up uninstall'
complete -c skl-x -n __skl_x_needs_command -a 'list ls remove rm cost cst usage usg completion add sln update up uninstall'

for sub in rm remove
  complete -c skl -n "__skl_x_using_subcommand $sub" -f -a '(__skl_x_skill_names)'
  complete -c skl-x -n "__skl_x_using_subcommand $sub" -f -a '(__skl_x_skill_names)'
  complete -c skl -n "__skl_x_using_subcommand $sub" -s g -l global -d 'Use global scope'
  complete -c skl -n "__skl_x_using_subcommand $sub" -s y -l yes -d 'Skip confirmation prompt'
  complete -c skl -n "__skl_x_using_subcommand $sub" -s x -l reject -d 'With .: skills to keep'
  complete -c skl -n "__skl_x_using_subcommand $sub" -s m -l mode -xa 'sm md lg' -d 'Output mode'
  complete -c skl -n "__skl_x_using_subcommand $sub" -l lock-only -d 'Only remove lock entry'
  complete -c skl -n "__skl_x_using_subcommand $sub" -l agents-only -d 'Only remove from .agents/skills'
  complete -c skl -n "__skl_x_using_subcommand $sub" -l claude-only -d 'Only remove from .claude/skills'
end

for bin in skl skl-x
  complete -c $bin -n "__skl_x_using_subcommand add" -s s -l skill -d 'Skill names'
  complete -c $bin -n "__skl_x_using_subcommand add" -s a -l agent -xa 'codex claude-code' -d 'Target agent'
  complete -c $bin -n "__skl_x_using_subcommand add" -s y -l yes -d 'Skip prompts'
  complete -c $bin -n "__skl_x_using_subcommand add" -s m -l mode -xa 'sm md lg' -d 'Output mode'
  complete -c $bin -n "__skl_x_using_subcommand sln" -s s -l skill -d 'Skill names'
  complete -c $bin -n "__skl_x_using_subcommand sln" -s x -l reject -d 'Every skill except these'
  complete -c $bin -n "__skl_x_using_subcommand sln" -s a -l agent -xa 'codex claude-code' -d 'Target agent'
  complete -c $bin -n "__skl_x_using_subcommand sln" -s y -l yes -d 'Replace without asking'
  complete -c $bin -n "__skl_x_using_subcommand sln" -s m -l mode -xa 'sm md lg' -d 'Output mode'
end

for sub in completion
  complete -c skl -n "__skl_x_using_subcommand $sub" -f -a 'bash zsh fish'
  complete -c skl-x -n "__skl_x_using_subcommand $sub" -f -a 'bash zsh fish'
end
`;

export const completionCommand = defineCommand({
  meta: {
    description: 'Print shell completion script (bash, zsh, fish)',
  },
  args: {
    shell: {
      type: 'positional',
      required: true,
      description: 'Target shell: bash, zsh, or fish',
    },
  },
  run({ args }) {
    const shell = String((args as { shell?: string }).shell ?? '');
    switch (shell) {
      case 'bash':
        process.stdout.write(BASH);
        return;
      case 'zsh':
        process.stdout.write(ZSH);
        return;
      case 'fish':
        process.stdout.write(FISH);
        return;
      default:
        console.error(`unknown shell: ${shell || '(none)'} - supported: bash, zsh, fish`);
        process.exit(1);
    }
  },
});
