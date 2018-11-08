import yargs from 'yargs'
import path from 'path'
import create from './cmds/create'
import start from './cmds/start'
import build from './cmds/build'

const cwd = process.cwd()
const cmdDir = path.resolve(__dirname, '../')
const argv = yargs
  .command(
    'create [name]',
    'Create React project',
    {
      name: { description: 'project name' },
      at: { description: 'sepcify jm-cli version', alias: 'a' },
      template: { description: 'template name in npm, file:// or url', alias: 't' },
    },
    argv => {
      create(cwd, cmdDir, {
        name: argv.name,
        version: argv.at,
        template: argv.template,
      })
    },
  )
  .command(
    'start',
    'Start development server',
    {
      entry: {
        description: 'sepcify entry names to build. example: a,b',
        alias: 'e',
      },
    },
    argv => {
      start(cwd, cmdDir, {
        entry: argv.entry ? (argv.entry as string).split(',') : undefined,
      })
    },
  )
  .command('build', 'Build project for development', {}, argv => {
    build()
  })
  .command('analyze', 'Analyze webpack bundle', {}, argv => {})
  .command('deploy', 'TODO', {}, argv => {})
  .help().argv
