import React from 'react';
import PropTypes from 'prop-types';
import { ModelVersionTable } from './ModelVersionTable';
import Utils from '../../common/utils/Utils';
import { Link } from 'react-router-dom';
import { modelListPageRoute, getCompareModelVersionsPageRoute, getModelPageRoute } from '../routes';
import { message } from 'antd';
import { ACTIVE_STAGES } from '../constants';
import { CollapsibleSection } from '../../common/components/CollapsibleSection';
import { EditableNote } from '../../common/components/EditableNote';
import { EditableTagsTableView } from '../../common/components/EditableTagsTableView';
import { getRegisteredModelTags } from '../reducers';
import { setRegisteredModelTagApi, deleteRegisteredModelTagApi } from '../actions';
import { connect } from 'react-redux';
import { OverflowMenu, PageHeader } from '../../shared/building_blocks/PageHeader';
import { FormattedMessage, injectIntl } from 'react-intl';
import {
  Modal,
  Button,
  SegmentedControlGroup,
  SegmentedControlButton,
} from '@databricks/design-system';
import { Descriptions } from '../../common/components/Descriptions';

export const StageFilters = {
  ALL: 'ALL',
  ACTIVE: 'ACTIVE',
};

export class ModelViewImpl extends React.Component {
  constructor(props) {
    super(props);
    this.onCompare = this.onCompare.bind(this);
  }

  static propTypes = {
    model: PropTypes.shape({
      name: PropTypes.string.isRequired,
      creation_timestamp: PropTypes.number.isRequired,
      last_updated_timestamp: PropTypes.number.isRequired,
    }),
    modelVersions: PropTypes.arrayOf(
      PropTypes.shape({
        current_stage: PropTypes.string.isRequired,
      }),
    ),
    handleEditDescription: PropTypes.func.isRequired,
    handleDelete: PropTypes.func.isRequired,
    history: PropTypes.object.isRequired,
    tags: PropTypes.object.isRequired,
    setRegisteredModelTagApi: PropTypes.func.isRequired,
    deleteRegisteredModelTagApi: PropTypes.func.isRequired,
    intl: PropTypes.any,
  };

  state = {
    stageFilter: StageFilters.ALL,
    showDescriptionEditor: false,
    isDeleteModalVisible: false,
    isDeleteModalConfirmLoading: false,
    runsSelected: {},
    isTagsRequestPending: false,
    updatingEmailPreferences: false,
  };

  formRef = React.createRef();

  componentDidMount() {
    const pageTitle = `${this.props.model.name} - MLflow Model`;
    Utils.updatePageTitle(pageTitle);
  }

  handleStageFilterChange = (e) => {
    this.setState({ stageFilter: e.target.value });
  };

  getActiveVersionsCount() {
    const { modelVersions } = this.props;
    return modelVersions
      ? modelVersions.filter((v) => ACTIVE_STAGES.includes(v.current_stage)).length
      : 0;
  }

  handleCancelEditDescription = () => {
    this.setState({ showDescriptionEditor: false });
  };

  handleSubmitEditDescription = (description) => {
    return this.props.handleEditDescription(description).then(() => {
      this.setState({ showDescriptionEditor: false });
    });
  };

  startEditingDescription = (e) => {
    e.stopPropagation();
    this.setState({ showDescriptionEditor: true });
  };

  getOverflowMenuItems() {
    const menuItems = [
      {
        id: 'delete',
        itemName: (
          <FormattedMessage
            defaultMessage='Delete'
            // eslint-disable-next-line max-len
            description='Text for disabled delete button due to active versions on model view page header'
          />
        ),
        onClick: this.showDeleteModal,
        disabled: this.getActiveVersionsCount() > 0,
      },
    ];

    return menuItems;
  }

  showDeleteModal = () => {
    this.setState({ isDeleteModalVisible: true });
  };

  hideDeleteModal = () => {
    this.setState({ isDeleteModalVisible: false });
  };

  showConfirmLoading = () => {
    this.setState({ isDeleteModalConfirmLoading: true });
  };

  hideConfirmLoading = () => {
    this.setState({ isDeleteModalConfirmLoading: false });
  };

  handleDeleteConfirm = () => {
    const { history } = this.props;
    this.showConfirmLoading();
    this.props
      .handleDelete()
      .then(() => {
        history.push(modelListPageRoute);
      })
      .catch((e) => {
        this.hideConfirmLoading();
        Utils.logErrorAndNotifyUser(e);
      });
  };

  handleAddTag = (values) => {
    const form = this.formRef.current;
    const { model } = this.props;
    const modelName = model.name;
    this.setState({ isTagsRequestPending: true });
    this.props
      .setRegisteredModelTagApi(modelName, values.name, values.value)
      .then(() => {
        this.setState({ isTagsRequestPending: false });
        form.resetFields();
      })
      .catch((ex) => {
        this.setState({ isTagsRequestPending: false });
        console.error(ex);
        message.error('Failed to add tag. Error: ' + ex.getUserVisibleError());
      });
  };

  handleSaveEdit = ({ name, value }) => {
    const { model } = this.props;
    const modelName = model.name;
    return this.props.setRegisteredModelTagApi(modelName, name, value).catch((ex) => {
      console.error(ex);
      message.error('Failed to set tag. Error: ' + ex.getUserVisibleError());
    });
  };

  handleDeleteTag = ({ name }) => {
    const { model } = this.props;
    const modelName = model.name;
    return this.props.deleteRegisteredModelTagApi(modelName, name).catch((ex) => {
      console.error(ex);
      message.error('Failed to delete tag. Error: ' + ex.getUserVisibleError());
    });
  };

  onChange = (selectedRowKeys, selectedRows) => {
    const newState = Object.assign({}, this.state);
    newState.runsSelected = {};
    selectedRows.forEach((row) => {
      newState.runsSelected = {
        ...newState.runsSelected,
        [row.version]: row.run_id,
      };
    });
    this.setState(newState);
  };

  onCompare() {
    this.props.history.push(
      getCompareModelVersionsPageRoute(this.props.model.name, this.state.runsSelected),
    );
  }

  renderDescriptionEditIcon() {
    return (
      <Button
        data-test-id='descriptionEditButton'
        type='link'
        css={styles.editButton}
        onClick={this.startEditingDescription}
      >
        <FormattedMessage
          defaultMessage='Edit'
          description='Text for the edit button next to the description section title on
             the model view page'
        />
      </Button>
    );
  }

  renderDetails = () => {
    const { model, modelVersions, tags } = this.props;
    const {
      stageFilter,
      showDescriptionEditor,
      isDeleteModalVisible,
      isDeleteModalConfirmLoading,
      isTagsRequestPending,
    } = this.state;
    const modelName = model.name;
    const compareDisabled = Object.keys(this.state.runsSelected).length < 2;
    return (
      <div css={styles.wrapper}>
        {/* Metadata List */}
        <Descriptions columns={3} data-testid='model-view-metadata'>
          <Descriptions.Item
            data-testid='model-view-metadata-item'
            label={this.props.intl.formatMessage({
              defaultMessage: 'Created Time',
              description:
                'Label name for the created time under details tab on the model view page',
            })}
          >
            {Utils.formatTimestamp(model.creation_timestamp)}
          </Descriptions.Item>
          <Descriptions.Item
            data-testid='model-view-metadata-item'
            label={this.props.intl.formatMessage({
              defaultMessage: 'Last Modified',
              description:
                'Label name for the last modified time under details tab on the model view page',
            })}
          >
            {Utils.formatTimestamp(model.last_updated_timestamp)}
          </Descriptions.Item>
          {/* Reported during ESLint upgrade */}
          {/* eslint-disable-next-line react/prop-types */}
          {model.user_id && (
            <Descriptions.Item
              data-testid='model-view-metadata-item'
              label={this.props.intl.formatMessage({
                defaultMessage: 'Creator',
                description: 'Lable name for the creator under details tab on the model view page',
              })}
            >
              {/* eslint-disable-next-line react/prop-types */}
              <div>{model.user_id}</div>
            </Descriptions.Item>
          )}
        </Descriptions>

        {/* Page Sections */}
        <CollapsibleSection
          css={styles.collapsiblePanel}
          title={
            <span>
              <FormattedMessage
                defaultMessage='Description'
                description='Title text for the description section under details tab on the model
                   view page'
              />{' '}
              {!showDescriptionEditor ? this.renderDescriptionEditIcon() : null}
            </span>
          }
          forceOpen={showDescriptionEditor}
          // Reported during ESLint upgrade
          // eslint-disable-next-line react/prop-types
          defaultCollapsed={!model.description}
          data-test-id='model-description-section'
        >
          <EditableNote
            // Reported during ESLint upgrade
            // eslint-disable-next-line react/prop-types
            defaultMarkdown={model.description}
            onSubmit={this.handleSubmitEditDescription}
            onCancel={this.handleCancelEditDescription}
            showEditor={showDescriptionEditor}
          />
        </CollapsibleSection>
        <div data-test-id='tags-section'>
          <CollapsibleSection
            title={
              <FormattedMessage
                defaultMessage='Tags'
                description='Title text for the tags section under details tab on the model view
                   page'
              />
            }
            defaultCollapsed={Utils.getVisibleTagValues(tags).length === 0}
            data-test-id='model-tags-section'
          >
            <EditableTagsTableView
              innerRef={this.formRef}
              handleAddTag={this.handleAddTag}
              handleDeleteTag={this.handleDeleteTag}
              handleSaveEdit={this.handleSaveEdit}
              tags={tags}
              isRequestPending={isTagsRequestPending}
            />
          </CollapsibleSection>
        </div>
        <CollapsibleSection
          title={
            <>
              <div css={styles.versionsTabButtons}>
                <span>
                  <FormattedMessage
                    defaultMessage='Versions'
                    description='Title text for the versions section under details tab on the
                       model view page'
                  />
                </span>
                <SegmentedControlGroup
                  value={this.state.stageFilter}
                  onChange={(e) => this.handleStageFilterChange(e)}
                >
                  <SegmentedControlButton value={StageFilters.ALL}>
                    <FormattedMessage
                      defaultMessage='All'
                      description={
                        'Tab text to view all versions under details tab on' +
                        ' the model view page'
                      }
                    />
                  </SegmentedControlButton>
                  <SegmentedControlButton value={StageFilters.ACTIVE}>
                    <FormattedMessage
                      defaultMessage='Active'
                      description='Tab text to view active versions under details tab
                               on the model view page'
                    />{' '}
                    {this.getActiveVersionsCount()}
                  </SegmentedControlButton>
                </SegmentedControlGroup>
                <Button
                  data-test-id='compareButton'
                  disabled={compareDisabled}
                  onClick={this.onCompare}
                >
                  <FormattedMessage
                    defaultMessage='Compare'
                    description='Text for compare button to compare versions under details tab
                       on the model view page'
                  />
                </Button>
              </div>
            </>
          }
          data-test-id='model-versions-section'
        >
          <ModelVersionTable
            activeStageOnly={stageFilter === StageFilters.ACTIVE}
            modelName={modelName}
            modelVersions={modelVersions}
            onChange={this.onChange}
          />
        </CollapsibleSection>

        {/* Delete Model Dialog */}
        <Modal
          title={this.props.intl.formatMessage({
            defaultMessage: 'Delete Model',
            description: 'Title text for delete model modal on model view page',
          })}
          visible={isDeleteModalVisible}
          confirmLoading={isDeleteModalConfirmLoading}
          onOk={this.handleDeleteConfirm}
          okText={this.props.intl.formatMessage({
            defaultMessage: 'Delete',
            description: 'OK text for delete model modal on model view page',
          })}
          cancelText={this.props.intl.formatMessage({
            defaultMessage: 'Cancel',
            description: 'Cancel text for delete model modal on model view page',
          })}
          okType='danger'
          onCancel={this.hideDeleteModal}
        >
          <span>
            <FormattedMessage
              defaultMessage='Are you sure you want to delete {modelName}? This cannot be undone.'
              description='Confirmation message for delete model modal on model view page'
              values={{ modelName: modelName }}
            />
          </span>
        </Modal>
      </div>
    );
  };

  renderMainPanel() {
    return this.renderDetails();
  }

  render() {
    const { model } = this.props;
    const modelName = model.name;

    const breadcrumbs = [
      <Link to={modelListPageRoute}>
        <FormattedMessage
          defaultMessage='Registered Models'
          description='Text for link back to model page under the header on the model view page'
        />
      </Link>,
      <Link data-test-id='breadcrumbRegisteredModel' to={getModelPageRoute(modelName)}>
        {modelName}
      </Link>,
    ];
    return (
      <div>
        <PageHeader title={modelName} breadcrumbs={breadcrumbs}>
          <OverflowMenu menu={this.getOverflowMenuItems()} />
        </PageHeader>
        {this.renderMainPanel()}
      </div>
    );
  }
}

const mapStateToProps = (state, ownProps) => {
  const modelName = ownProps.model.name;
  const tags = getRegisteredModelTags(modelName, state);
  return { tags };
};
const mapDispatchToProps = { setRegisteredModelTagApi, deleteRegisteredModelTagApi };

const styles = {
  emailNotificationPreferenceDropdown: (theme) => ({ width: 300, marginBottom: theme.spacing.md }),
  emailNotificationPreferenceTip: (theme) => ({
    paddingLeft: theme.spacing.sm,
    paddingRight: theme.spacing.sm,
  }),
  wrapper: (theme) => ({
    '.collapsible-panel': {
      marginBottom: theme.spacing.md,
    },
    /**
     * This seems to be a best and most stable method to catch
     * antd's collapsible section buttons without hacks
     * and using class names.
     */
    'div[role="button"][aria-expanded]': {
      height: theme.general.buttonHeight,
    },
  }),
  editButton: (theme) => ({
    marginLeft: theme.spacing.md,
  }),
  versionsTabButtons: (theme) => ({
    display: 'flex',
    gap: theme.spacing.md,
    alignItems: 'center',
  }),
};

export const ModelView = connect(mapStateToProps, mapDispatchToProps)(injectIntl(ModelViewImpl));
