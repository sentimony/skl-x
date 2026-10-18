import { describe, expect, it } from 'vitest';
import { run } from './helpers';

describe('skl completion', () => {
  it('prints bash completion script', () => {
    const { stdout, exitCode } = run(['completion', 'bash'], process.cwd());
    expect(exitCode).toBe(0);
    expect(stdout).toContain('_skl_x_completions()');
    expect(stdout).toContain('complete -F _skl_x_completions skl\n');
    expect(stdout).toContain('complete -F _skl_x_completions skl-x\n');
    expect(stdout).not.toMatch(/skillio|sklx/);
    expect(stdout).toContain('skl list --names');
  });

  it('prints zsh completion script', () => {
    const { stdout, exitCode } = run(['completion', 'zsh'], process.cwd());
    expect(exitCode).toBe(0);
    expect(stdout).toContain('compdef _skl_x skl skl-x');
    expect(stdout).not.toMatch(/skillio|sklx/);
    expect(stdout).toContain('skl list --names');
  });

  it('prints fish completion script', () => {
    const { stdout, exitCode } = run(['completion', 'fish'], process.cwd());
    expect(exitCode).toBe(0);
    expect(stdout).toContain('__skl_x_skill_names');
    expect(stdout).toContain('complete -c skl-x -n __skl_x_needs_command');
    expect(stdout).not.toMatch(/skillio|sklx/);
    expect(stdout).toContain('skl list --names');
  });

  it('errors on unknown shell with exit 1', () => {
    const { stderr, exitCode } = run(['completion', 'ohmyzsh'], process.cwd());
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown shell: ohmyzsh');
  });

  it('completes commands and add, sln, rm flags in every shell', () => {
    const bash = run(['completion', 'bash'], process.cwd()).stdout;
    expect(bash).toContain('local cmds="list ls remove rm cost cst usage usg completion add sln update up uninstall"');
    expect(bash).toContain('    add)');
    expect(bash).toContain('    sln)');
    expect(bash).toContain('"-s --skill -a --agent -y --yes -m --mode -h --help"');
    expect(bash).toContain('"-s --skill -x --reject -a --agent -y --yes -m --mode -h --help"');
    expect(bash).toContain('compgen -W "codex claude-code"');
    expect(bash.split('compgen -W "sm md lg"').length - 1).toBe(3);
    expect(bash).not.toMatch(/\binstall|-ln|--link|symlink|stealth|-sm/);
    const zsh = run(['completion', 'zsh'], process.cwd()).stdout;
    expect(zsh).toContain("'add:Install skills via npx skills add'");
    expect(zsh).toContain("'sln:Symlink skills from a local clone'");
    expect(zsh.split("_values 'mode' sm md lg").length - 1).toBe(3);
    expect(zsh).not.toMatch(/\binstall|-ln|--link|symlink:|stealth|-sm\[|'cs:|'us:/);
    const fish = run(['completion', 'fish'], process.cwd()).stdout;
    expect(fish).toContain("-a 'list ls remove rm cost cst usage usg completion add sln update up uninstall'");
    expect(fish).toContain("-s a -l agent -xa 'codex claude-code'");
    expect(fish.split("-s m -l mode -xa 'sm md lg'").length - 1).toBe(3);
    expect(fish).not.toMatch(/\binstall|-o ln|--link|symlink sym sl|stealth/);
  });
});
