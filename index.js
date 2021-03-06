/* global __VALIDATOR_WARN__ */

import {Component, PropTypes, isValidElement} from 'react'

const defaultName = () => 'validate-' + (Math.random() + '').slice(2, 7)

const isDefined = v => v !== undefined && v !== null

const warn = (...args) => {
  if (typeof __VALIDATOR_WARN__ !== 'undefined') {
    __VALIDATOR_WARN__(...args)
  } else if (typeof console !== 'undefined' && console.warn) {
    console.warn(...args)
  }
}

const missingPromise = () => {
  const msg = [
    'Missing a Promise binding!',
    'You should either have global \'Promise\' available',
    'or introduce custom one as \'Validate.usePromise(Promise)\''
  ].join('\n')

  warn(msg)
  throw new Error('Missing a Promise binding')
}

missingPromise.all = missingPromise

const validateMembers = (value, members) => {
  const errors = Object.keys(members)
    .reduce((errors, name) => {
      return [...errors, ...members[name].errors]
    }, [])
  return errors
}

class Validate extends Component {

  static propTypes = {
    children : PropTypes.func.isRequired,
    explicit : PropTypes.bool,
    name     : PropTypes.string,
    parent   : PropTypes.shape({
      name     : PropTypes.string,
      onChange : PropTypes.func
    }),
    onChange   : PropTypes.func,
    pristine   : PropTypes.bool,
    valid      : PropTypes.bool,
    validators : PropTypes.arrayOf(PropTypes.func),
    value      : PropTypes.any
  }

  static defaultProps = {
    parent     : null,
    validators : [validateMembers],
    value      : '',
    explicit   : false,
    onChange   : () => undefined
  }

  static Promise = typeof Promise === 'undefined' ? missingPromise : Promise

  static usePromise = Promise => {
    Validate.Promise = Promise
    return Validate
  }

  constructor (...args) {
    super(...args)

    const {children, name, value} = this.props

    if (!children || !children.call) {
      throw new Error(
        'Expected props.children to be a function ' +
        '<Validate>{options => element}</Validate'
      )
    }

    this.name = name || defaultName()
    this.state = {
      value,
      members  : {},
      pristine : true,
      pending  : false,
      valid    : this.props.valid !== undefined ? this.props.valid : true,
      errors   : []
    }

    this._validationRun = 0
  }

  check = () => {
    this.setState({pristine: false})
    const {value, members} = this.state
    return this._validate(value, members).then(complete => {
      if (!complete) return Promise.reject()
      this.props.onChange(value, this.state.valid)
      return this.state.valid
    })
  }

  onChange = (value, silent = false) => {
    const {explicit, onChange} = this.props
    if (explicit) return this.setState({value})

    const {pristine, members} = this.state

    this.setState(state => ({...state,
      value,
      pristine: pristine && silent
    }), () => {
      this._validate(value, members).then(complete => {
        if (!complete) return
        onChange(this.state.value, this.state.valid)
      })
    })
  }

  onReport = (name, member, pristine) => {
    const {explicit} = this.props

    this.setState(state => ({...state,
      members  : {...state.members, [name]: member},
      pristine : explicit ? state.pristine : (state.pristine && pristine)
    }), () => {
      if (!explicit) this._validate(this.state.value, this.state.members)
    })
  }

  onLeave = name => {
    const {explicit} = this.props
    const {members} = this.state

    if (!members[name]) return

    const nextMembers = {...members}
    delete nextMembers[name]

    this.setState({
      members: nextMembers
    }, () => {
      if (!explicit) this._validate(this.state.value, this.state.members)
    })
  }

  componentDidMount () {
    const {explicit, valid, value} = this.props
    if (!explicit && valid === undefined) this._validate(value, {}, true)
  }

  componentWillUnmount () {
    const {parent} = this.props
    parent && parent.leave(this.name)
  }

  componentWillReceiveProps (nextProps) {
    if (!(value in nextProps) || nextProps.value === this.state.value) return

    const {value, parent, onChange} = nextProps
    this._validate(value, this.state.members).then(complete => {
      if (!complete) return
      onChange(this.state.value, this.state.valid)
      parent && parent.report(this.name, this.state)
    })
  }

  render () {
    const {parent, children: render} = this.props
    const opts = {
      name     : this.name,
      check    : this.check,
      errors   : this.state.errors,
      members  : this.state.members,
      onChange : this.onChange,
      pending  : this.state.pending,
      pristine : (!parent || parent.pristine) && this.state.pristine,
      valid    : this.state.valid,
      value    : this.state.value
    }

    opts.group = {
      pristine : opts.pristine,
      report   : this.onReport,
      check    : this.check
    }

    if (!render || !render.call) {
      throw new Error(
        'Missing a render function. Expected ' +
        '<Validate>{options => element}</Validate'
      )
    }

    const content = render(opts)
    return isValidElement(content) ? content : null
  }

  _validate (value, members, pristine) {
    let isAsync = false
    const Promise = Validate.Promise
    const run = ++this._validationRun
    const {validators, parent} = this.props

    const errors = validators.reduce((errors, validate) => {
      const error = validate(value, members || {})
      if (!isDefined(error)) return errors

      isAsync = isAsync || !!error.then
      return errors.concat(error) // either one or Array of errors
    }, [])

    if (isAsync) {
      this.setState({pending: true})
      return Promise.all(
        errors.concat(run)
      ).then(errors => {
        if (errors.pop() !== this._validationRun) return false
        errors = errors.filter(isDefined)
        this.setState({
          errors,
          valid   : errors.length === 0,
          pending : false
        }, () => parent && parent.report(this.name, this.state, pristine))
        return true
      }).catch(err => {
        this.setState({pending: false})
        warn('Validation failed', err)
        return false
      })
    } else {
      this.setState({
        errors,
        valid: errors.length === 0
      }, () => parent && parent.report(this.name, this.state, pristine))
      return Promise.resolve(true)
    }
  }
}

export default Validate
